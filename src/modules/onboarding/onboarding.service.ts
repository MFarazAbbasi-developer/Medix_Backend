import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { StockMovementType, CustomerLedgerEntryType, SupplierLedgerEntryType } from '@prisma/client';

export interface OnboardingStatusResult {
  isInitialized: boolean;
  appVersion: string;
  systemName: string;
  overallProgress: number; // 0 to 100
  steps: {
    businessProfile: {
      completed: boolean;
      organizationId?: string;
      name?: string;
      legalName?: string | null;
      city?: string | null;
      ntn?: string | null;
      drugSaleLicenseNo?: string | null;
    };
    branchAndWarehouse: {
      completed: boolean;
      branchCount: number;
      warehouseCount: number;
      hasHeadOffice: boolean;
      hasQuarantineWarehouse: boolean;
    };
    users: {
      completed: boolean;
      userCount: number;
      adminConfigured: boolean;
    };
    masterData: {
      completed: boolean;
      productsCount: number;
      customersCount: number;
      suppliersCount: number;
      categoriesCount: number;
      manufacturersCount: number;
      unitsCount: number;
    };
    openingBalances: {
      completed: boolean;
      customerBalancesCount: number;
      totalReceivable: number;
      supplierBalancesCount: number;
      totalPayable: number;
    };
    openingStock: {
      completed: boolean;
      batchesCount: number;
      stockMovementsCount: number;
      totalUnitsInStock: number;
      totalStockValuation: number;
    };
    systemReadiness: {
      completed: boolean;
      settingsCount: number;
      numberingSeriesCount: number;
    };
  };
  summary: {
    totalSteps: number;
    completedSteps: number;
    canComplete: boolean;
  };
}

@Injectable()
export class OnboardingService {
  private readonly logger = new Logger(OnboardingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  /**
   * Retrieves or initializes the system installation record.
   */
  private async getOrCreateInstallation() {
    let installation = await this.prisma.systemInstallation.findFirst();
    if (!installation) {
      installation = await this.prisma.systemInstallation.create({
        data: {
          installationKey: `MEDIX-${Date.now().toString(36).toUpperCase()}`,
          appVersion: '1.0.0',
          systemName: 'Medix by FARMAX',
          isInitialized: false,
        },
      });
    }
    return installation;
  }

  /**
   * Aggregates real-time setup progress across all system domains.
   */
  async getStatus(): Promise<OnboardingStatusResult> {
    const [
      installation,
      org,
      branches,
      warehouses,
      users,
      productsCount,
      customersCount,
      suppliersCount,
      categoriesCount,
      manufacturersCount,
      unitsCount,
      customerOpeningEntries,
      supplierOpeningEntries,
      stockMovements,
      batchesCount,
      settingsCount,
      numberingSeriesCount,
    ] = await Promise.all([
      this.getOrCreateInstallation(),
      this.prisma.organization.findFirst(),
      this.prisma.branch.findMany({ where: { isActive: true } }),
      this.prisma.warehouse.findMany({ where: { isActive: true } }),
      this.prisma.user.findMany({
        where: { status: 'ACTIVE' },
        include: { userRoles: { include: { role: true } } },
      }),
      this.prisma.product.count(),
      this.prisma.customer.count(),
      this.prisma.supplier.count(),
      this.prisma.productCategory.count(),
      this.prisma.manufacturer.count(),
      this.prisma.unitOfMeasurement.count(),
      this.prisma.customerLedgerEntry.findMany({
        where: { entryType: CustomerLedgerEntryType.OPENING_BALANCE },
        select: { debit: true, customerId: true },
      }),
      this.prisma.supplierLedgerEntry.findMany({
        where: { entryType: SupplierLedgerEntryType.OPENING_BALANCE },
        select: { credit: true, supplierId: true },
      }),
      this.prisma.stockMovement.findMany({
        where: { movementType: StockMovementType.OPENING_BALANCE },
        select: { quantity: true, unitCost: true },
      }),
      this.prisma.batch.count(),
      this.prisma.systemSetting.count(),
      this.prisma.numberingSeries.count(),
    ]);

    // 1. Business Profile Step
    const businessCompleted = Boolean(org && org.name && org.ntn && org.drugSaleLicenseNo);
    const businessProfile = {
      completed: businessCompleted,
      organizationId: org?.id,
      name: org?.name,
      legalName: org?.legalName,
      city: org?.city,
      ntn: org?.ntn,
      drugSaleLicenseNo: org?.drugSaleLicenseNo,
    };

    // 2. Branch and Warehouse Step
    const hasHeadOffice = branches.some((b) => b.isHeadOffice);
    const hasQuarantine = warehouses.some((w) => w.warehouseType === 'QUARANTINE');
    const branchWarehouseCompleted = branches.length > 0 && warehouses.length > 0 && hasHeadOffice;
    const branchAndWarehouse = {
      completed: branchWarehouseCompleted,
      branchCount: branches.length,
      warehouseCount: warehouses.length,
      hasHeadOffice,
      hasQuarantineWarehouse: hasQuarantine,
    };

    // 3. Users Step
    const hasAdmin = users.some((u) => u.userRoles.some((ur) => ur.role.name === 'ADMIN'));
    const usersCompleted = users.length > 0 && hasAdmin;
    const usersStep = {
      completed: usersCompleted,
      userCount: users.length,
      adminConfigured: hasAdmin,
    };

    // 4. Master Data Step (Products, Customers, Suppliers, Categories, UOMs)
    const masterDataCompleted = productsCount > 0 && customersCount > 0 && suppliersCount > 0;
    const masterData = {
      completed: masterDataCompleted,
      productsCount,
      customersCount,
      suppliersCount,
      categoriesCount,
      manufacturersCount,
      unitsCount,
    };

    // 5. Opening Balances Step
    const uniqueCustomerBalances = new Set(customerOpeningEntries.map((e) => e.customerId)).size;
    const totalReceivable = customerOpeningEntries.reduce((sum, e) => sum + Number(e.debit), 0);
    const uniqueSupplierBalances = new Set(supplierOpeningEntries.map((e) => e.supplierId)).size;
    const totalPayable = supplierOpeningEntries.reduce((sum, e) => sum + Number(e.credit), 0);
    const openingBalancesCompleted = uniqueCustomerBalances > 0 || uniqueSupplierBalances > 0;
    const openingBalances = {
      completed: openingBalancesCompleted,
      customerBalancesCount: uniqueCustomerBalances,
      totalReceivable: Number(totalReceivable.toFixed(2)),
      supplierBalancesCount: uniqueSupplierBalances,
      totalPayable: Number(totalPayable.toFixed(2)),
    };

    // 6. Opening Stock Step
    const totalUnits = stockMovements.reduce((sum, m) => sum + m.quantity, 0);
    const totalValuation = stockMovements.reduce(
      (sum, m) => sum + m.quantity * Number(m.unitCost),
      0,
    );
    const openingStockCompleted = stockMovements.length > 0 && totalUnits > 0;
    const openingStock = {
      completed: openingStockCompleted,
      batchesCount,
      stockMovementsCount: stockMovements.length,
      totalUnitsInStock: totalUnits,
      totalStockValuation: Number(totalValuation.toFixed(2)),
    };

    // 7. System Readiness Step
    const systemReadinessCompleted = settingsCount > 0 && numberingSeriesCount > 0;
    const systemReadiness = {
      completed: systemReadinessCompleted,
      settingsCount,
      numberingSeriesCount,
    };

    // Count completed steps
    const stepList = [
      businessCompleted,
      branchWarehouseCompleted,
      usersCompleted,
      masterDataCompleted,
      openingBalancesCompleted,
      openingStockCompleted,
      systemReadinessCompleted,
    ];
    const completedCount = stepList.filter(Boolean).length;
    const overallProgress = Math.round((completedCount / stepList.length) * 100);

    // Can complete if foundational steps are satisfied (Business, Branches, Users, Settings)
    const canComplete = businessCompleted && branchWarehouseCompleted && usersCompleted && systemReadinessCompleted;

    return {
      isInitialized: installation.isInitialized,
      appVersion: installation.appVersion,
      systemName: installation.systemName,
      overallProgress,
      steps: {
        businessProfile,
        branchAndWarehouse,
        users: usersStep,
        masterData,
        openingBalances,
        openingStock,
        systemReadiness,
      },
      summary: {
        totalSteps: stepList.length,
        completedSteps: completedCount,
        canComplete,
      },
    };
  }

  /**
   * Finalizes onboarding setup and marks the system as initialized.
   */
  async completeOnboarding(userId?: string) {
    const installation = await this.getOrCreateInstallation();

    const updated = await this.prisma.systemInstallation.update({
      where: { id: installation.id },
      data: {
        isInitialized: true,
        updatedAt: new Date(),
      },
    });

    await this.auditService.log({
      userId,
      action: 'COMPLETE_ONBOARDING',
      entity: 'SYSTEM_INSTALLATION',
      entityId: updated.id,
      details: {
        installationKey: updated.installationKey,
        appVersion: updated.appVersion,
        timestamp: new Date().toISOString(),
      },
    });

    return this.getStatus();
  }

  /**
   * Reopens onboarding mode.
   */
  async resetOnboarding(userId?: string) {
    const installation = await this.getOrCreateInstallation();

    const updated = await this.prisma.systemInstallation.update({
      where: { id: installation.id },
      data: {
        isInitialized: false,
        updatedAt: new Date(),
      },
    });

    await this.auditService.log({
      userId,
      action: 'RESET_ONBOARDING',
      entity: 'SYSTEM_INSTALLATION',
      entityId: updated.id,
      details: {
        installationKey: updated.installationKey,
      },
    });

    return this.getStatus();
  }
}
