import {
  Injectable,
  OnApplicationBootstrap,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { PasswordService } from './password.service';
import { INITIAL_PERMISSIONS, ROLE_ADMIN } from './constants';
import { AppConfig } from '../../config';

@Injectable()
export class AuthSeedService implements OnApplicationBootstrap {
  private readonly logger = new Logger(AuthSeedService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly passwordService: PasswordService,
    private readonly configService: ConfigService<AppConfig>,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      await this.seedPermissionsAndRoles();
      await this.seedInitialAdmin();
      await this.seedMasterData();
    } catch (error) {
      this.logger.error(
        `Bootstrap seeding encountered an issue: ${(error as Error).message}`,
      );
    }
  }

  /**
   * Idempotently seeds default Organization, Branch, Numbering Series, and System Settings.
   * Does NOT overwrite existing records or user configurations.
   */
  async seedMasterData(): Promise<void> {
    // 1. Seed default Organization if none exists
    let org = await this.prisma.organization.findFirst();
    if (!org) {
      org = await this.prisma.organization.create({
        data: {
          name: 'Medix Pharma Distribution',
          legalName: 'Medix Pharma Distribution (Pvt) Ltd',
          country: 'Pakistan',
          city: 'Karachi',
          state: 'Sindh',
          address: 'Main Distribution Hub, Sector 15, Korangi Industrial Area',
          phone: '+92-21-35000000',
          email: 'info@medixpharma.pk',
          website: 'https://medixpharma.pk',
          ntn: '7100234-5',
          strn: '17-00-7100-234-11',
          drugSaleLicenseNo: 'DSL-KHI-2026-894',
        },
      });
      this.logger.log(`Default organization created: "${org.name}"`);
    }

    // 2. Seed default Head Office Branch if none exists
    const existingBranch = await this.prisma.branch.findFirst({
      where: { organizationId: org.id },
    });

    let defaultBranch = existingBranch;
    if (!existingBranch) {
      defaultBranch = await this.prisma.branch.create({
        data: {
          organizationId: org.id,
          name: 'Head Office & Central Warehouse',
          code: 'HO',
          isHeadOffice: true,
          isActive: true,
          city: 'Karachi',
          address: 'Plot # 45-B, Commercial Area, Karachi',
          phone: '+92-21-35000001',
          email: 'headoffice@medixpharma.pk',
        },
      });
      this.logger.log(`Default branch created: "${defaultBranch.name}" (HO)`);
    }

    // 3. Seed default Numbering Series for all document types (if missing)
    const defaultSeriesList = [
      { documentType: 'SALES_INVOICE' as const, prefix: 'INV-', padding: 5 },
      { documentType: 'PURCHASE_INVOICE' as const, prefix: 'PINV-', padding: 5 },
      { documentType: 'PURCHASE_ORDER' as const, prefix: 'PO-', padding: 5 },
      { documentType: 'SALES_RETURN' as const, prefix: 'SRET-', padding: 5 },
      { documentType: 'PURCHASE_RETURN' as const, prefix: 'PRET-', padding: 5 },
      { documentType: 'PAYMENT_RECEIPT' as const, prefix: 'REC-', padding: 5 },
      { documentType: 'GOODS_RECEIVE_NOTE' as const, prefix: 'GRN-', padding: 5 },
      { documentType: 'STOCK_ADJUSTMENT' as const, prefix: 'ADJ-', padding: 5 },
      { documentType: 'STOCK_TRANSFER' as const, prefix: 'TRF-', padding: 5 },
      { documentType: 'PRODUCT_RECALL' as const, prefix: 'RCL-', padding: 5 },
      { documentType: 'DELIVERY_ORDER' as const, prefix: 'DO-', padding: 5 },
      { documentType: 'DELIVERY_CHALLAN' as const, prefix: 'DC-', padding: 5 },
      { documentType: 'PDC' as const, prefix: 'PDC-', padding: 5 },
      { documentType: 'TILL_SESSION' as const, prefix: 'CS-', padding: 5 },
    ];

    for (const item of defaultSeriesList) {
      const existing = await this.prisma.numberingSeries.findFirst({
        where: {
          organizationId: org.id,
          documentType: item.documentType,
          branchId: null,
        },
      });

      if (!existing) {
        await this.prisma.numberingSeries.create({
          data: {
            organizationId: org.id,
            branchId: null,
            documentType: item.documentType,
            prefix: item.prefix,
            nextNumber: 1,
            padding: item.padding,
            isActive: true,
          },
        });
      }
    }
    this.logger.log('Default document numbering series verified');

    // 4. Seed default System Settings (if missing)
    const defaultSettings = [
      {
        key: 'currency',
        value: 'PKR',
        dataType: 'STRING' as const,
        group: 'GENERAL',
        description: 'Default operating currency code',
      },
      {
        key: 'currencySymbol',
        value: 'Rs.',
        dataType: 'STRING' as const,
        group: 'GENERAL',
        description: 'Default operating currency display symbol',
      },
      {
        key: 'dateFormat',
        value: 'YYYY-MM-DD',
        dataType: 'STRING' as const,
        group: 'GENERAL',
        description: 'Standard date format for tables and reports',
      },
      {
        key: 'timeZone',
        value: 'Asia/Karachi',
        dataType: 'STRING' as const,
        group: 'GENERAL',
        description: 'System timezone (Pakistan Standard Time UTC+5)',
      },
      {
        key: 'defaultTaxRate',
        value: '0',
        dataType: 'NUMBER' as const,
        group: 'TAX',
        description: 'Default sales tax rate percentage (0% for standard medicine exempt)',
      },
      {
        key: 'invoiceFooterNote',
        value: 'Goods once sold will not be returned without original cash receipt. Warranty under Drug Act 1976.',
        dataType: 'STRING' as const,
        group: 'INVOICE',
        description: 'Default legal footer disclaimer printed on customer invoices',
      },
      {
        key: 'defaultBranchId',
        value: defaultBranch ? defaultBranch.id : '',
        dataType: 'STRING' as const,
        group: 'GENERAL',
        description: 'Default active branch for new transactions',
      },
      {
        key: 'allowNegativeStock',
        value: 'false',
        dataType: 'BOOLEAN' as const,
        group: 'INVENTORY',
        description: 'Enforce strict non-negative inventory balance policy',
      },
      {
        key: 'DEFAULT_SALES_PRICING_BASE',
        value: 'TP',
        dataType: 'STRING' as const,
        group: 'SALES',
        description: 'Default pricing base for sales lines (TP = Regulated Trade Price, MRP = Max Retail Price)',
      },
      {
        key: 'CASH_VARIANCE_APPROVAL_THRESHOLD',
        value: '500',
        dataType: 'NUMBER' as const,
        group: 'SALES',
        description: 'Maximum cash shortage/excess variance threshold (PKR) allowed without supervisor approval permission',
      },
      {
        key: 'REORDER_DEFAULT_LOOKBACK_DAYS',
        value: '30',
        dataType: 'NUMBER' as const,
        group: 'PURCHASING',
        description: 'Default sales velocity lookback window in days for replenishment suggestions',
      },
      {
        key: 'REORDER_DEFAULT_LEAD_TIME_DAYS',
        value: '7',
        dataType: 'NUMBER' as const,
        group: 'PURCHASING',
        description: 'Default supplier fulfillment lead time in days for replenishment calculations',
      },
      {
        key: 'REORDER_DEFAULT_SAFETY_STOCK_DAYS',
        value: '7',
        dataType: 'NUMBER' as const,
        group: 'PURCHASING',
        description: 'Default safety buffer days of sales for reorder point determination',
      },
      {
        key: 'REORDER_DEFAULT_TARGET_STOCK_DAYS',
        value: '30',
        dataType: 'NUMBER' as const,
        group: 'PURCHASING',
        description: 'Default target stock coverage horizon in days for maximum stock determination',
      },
      {
        key: 'REORDER_SHORT_EXPIRY_THRESHOLD_DAYS',
        value: '90',
        dataType: 'NUMBER' as const,
        group: 'PURCHASING',
        description: 'Default threshold in days for short-expiry stock segregation',
      },
    ];

    for (const s of defaultSettings) {
      const existing = await this.prisma.systemSetting.findUnique({
        where: {
          organizationId_key: {
            organizationId: org.id,
            key: s.key,
          },
        },
      });

      if (!existing) {
        await this.prisma.systemSetting.create({
          data: {
            organizationId: org.id,
            key: s.key,
            value: s.value,
            dataType: s.dataType,
            group: s.group,
            description: s.description,
          },
        });
      }
    }
    this.logger.log('Default system settings verified');

    // 5. Seed standard Units of Measurement (if missing)
    const standardUnits = [
      { name: 'Box', symbol: 'Box' },
      { name: 'Strip', symbol: 'Strip' },
      { name: 'Bottle', symbol: 'Btl' },
      { name: 'Ampoule', symbol: 'Amp' },
      { name: 'Vial', symbol: 'Vial' },
      { name: 'Syringe', symbol: 'Syr' },
      { name: 'Tube', symbol: 'Tube' },
      { name: 'Sachet', symbol: 'Sach' },
      { name: 'Drops Bottle', symbol: 'Drp' },
      { name: 'Packet', symbol: 'Pkt' },
    ];

    for (const u of standardUnits) {
      const existingUnit = await this.prisma.unitOfMeasurement.findUnique({
        where: {
          organizationId_symbol: {
            organizationId: org.id,
            symbol: u.symbol,
          },
        },
      });

      if (!existingUnit) {
        await this.prisma.unitOfMeasurement.create({
          data: {
            organizationId: org.id,
            name: u.name,
            symbol: u.symbol,
            isActive: true,
          },
        });
      }
    }
    this.logger.log('Default units of measurement verified');

    // 6. Seed default Product Categories (if missing)
    const defaultCategories = [
      { name: 'Antibiotics', code: 'CAT-ANTI' },
      { name: 'Analgesics & Antipyretics', code: 'CAT-ANAL' },
      { name: 'Cardiovascular', code: 'CAT-CARD' },
      { name: 'Gastrointestinal', code: 'CAT-GAST' },
      { name: 'Respiratory & Anti-Allergic', code: 'CAT-RESP' },
      { name: 'Dermatological', code: 'CAT-DERM' },
      { name: 'Nutritional & Vitamins', code: 'CAT-VIT' },
      { name: 'Medical Devices & Surgical', code: 'CAT-SURG' },
    ];

    for (const c of defaultCategories) {
      const existing = await this.prisma.productCategory.findUnique({
        where: {
          organizationId_name: {
            organizationId: org.id,
            name: c.name,
          },
        },
      });

      if (!existing) {
        await this.prisma.productCategory.create({
          data: {
            organizationId: org.id,
            name: c.name,
            code: c.code,
            isActive: true,
          },
        });
      }
    }
    this.logger.log('Default product categories verified');

    // 7. Seed default Warehouse per Branch (if missing)
    const branches = await this.prisma.branch.findMany({
      where: { organizationId: org.id },
    });

    for (const b of branches) {
      const existingWarehouse = await this.prisma.warehouse.findUnique({
        where: {
          branchId_code: {
            branchId: b.id,
            code: 'WH-MAIN',
          },
        },
      });

      if (!existingWarehouse) {
        await this.prisma.warehouse.create({
          data: {
            organizationId: org.id,
            branchId: b.id,
            name: 'Main Warehouse',
            code: 'WH-MAIN',
            warehouseType: 'STANDARD',
            isDefault: true,
            isActive: true,
          },
        });
      }

      const existingQuarantine = await this.prisma.warehouse.findUnique({
        where: {
          branchId_code: {
            branchId: b.id,
            code: 'WH-QUAR',
          },
        },
      });

      if (!existingQuarantine) {
        await this.prisma.warehouse.create({
          data: {
            organizationId: org.id,
            branchId: b.id,
            name: 'Quarantine Warehouse',
            code: 'WH-QUAR',
            warehouseType: 'QUARANTINE',
            isDefault: false,
            isActive: true,
          },
        });
      }
    }
    this.logger.log('Default branch warehouses (Standard & Quarantine) verified');

    // 8. Seed default Walk-in Cash Customer (if missing)
    const existingWalkIn = await this.prisma.customer.findUnique({
      where: {
        organizationId_code: {
          organizationId: org.id,
          code: 'CUST-WALKIN',
        },
      },
    });

    if (!existingWalkIn) {
      await this.prisma.customer.create({
        data: {
          organizationId: org.id,
          code: 'CUST-WALKIN',
          name: 'Walk-in Customer',
          customerType: 'WALK_IN',
          creditDays: 0,
          creditLimit: 0,
          currentBalance: 0,
          defaultDiscountPercentage: 0,
          isActive: true,
        },
      });
      this.logger.log('Default Walk-in Customer created: "Walk-in Customer" (CUST-WALKIN)');
    }
  }

  /**
   * Idempotently seeds initial permissions and the ADMIN role.
   */
  async seedPermissionsAndRoles(): Promise<void> {
    // 1. Seed or update all initial permissions
    for (const perm of INITIAL_PERMISSIONS) {
      await this.prisma.permission.upsert({
        where: { code: perm.code },
        update: { description: perm.description },
        create: {
          code: perm.code,
          description: perm.description,
        },
      });
    }

    // 2. Seed ADMIN role
    const adminRole = await this.prisma.role.upsert({
      where: { name: ROLE_ADMIN },
      update: { description: 'Full system administrator with unrestricted access' },
      create: {
        name: ROLE_ADMIN,
        description: 'Full system administrator with unrestricted access',
      },
    });

    // 3. Link all permissions to ADMIN role
    const allPermissions = await this.prisma.permission.findMany();
    for (const perm of allPermissions) {
      await this.prisma.rolePermission.upsert({
        where: {
          roleId_permissionId: {
            roleId: adminRole.id,
            permissionId: perm.id,
          },
        },
        update: {},
        create: {
          roleId: adminRole.id,
          permissionId: perm.id,
        },
      });
    }

    this.logger.log('RBAC initial permissions and ADMIN role verified');
  }

  /**
   * Idempotently creates the initial administrator user if no admin user exists.
   */
  async seedInitialAdmin(): Promise<void> {
    const initialAdminConfig =
      this.configService.get<AppConfig['initialAdmin']>('initialAdmin');

    const username = (
      initialAdminConfig?.username || 'admin'
    ).trim().toLowerCase();
    const displayName =
      initialAdminConfig?.displayName || 'System Administrator';
    const password = initialAdminConfig?.password;

    // Check if the initial admin user or any user already exists
    const existingUser = await this.prisma.user.findUnique({
      where: { username },
    });

    if (existingUser) {
      return; // Already initialized, no action needed
    }

    // Check if any admin role exists
    const adminRole = await this.prisma.role.findUnique({
      where: { name: ROLE_ADMIN },
    });

    if (!adminRole) {
      throw new Error(
        'Cannot seed initial administrator because ADMIN role does not exist',
      );
    }

    // If password is not provided in environment, fail clearly
    if (!password || password.trim().length === 0) {
      this.logger.error(
        '⚠️ CONFIGURATION REQUIRED: Initial administrator does not exist and INITIAL_ADMIN_PASSWORD is not set in environment. Set INITIAL_ADMIN_PASSWORD to initialize the admin account.',
      );
      return;
    }

    // Securely hash password using Argon2id (never logged)
    const passwordHash = await this.passwordService.hash(password);

    // Create initial administrator
    const newAdmin = await this.prisma.user.create({
      data: {
        username,
        displayName,
        passwordHash,
        status: 'ACTIVE',
      },
    });

    // Assign ADMIN role
    await this.prisma.userRole.create({
      data: {
        userId: newAdmin.id,
        roleId: adminRole.id,
      },
    });

    this.logger.log(`Initial administrator created with username: "${username}"`);
  }
}
