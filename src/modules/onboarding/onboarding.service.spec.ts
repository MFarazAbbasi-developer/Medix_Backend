import { describe, it, expect, beforeEach, vi } from 'vitest';
import { OnboardingService } from './onboarding.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

describe('OnboardingService', () => {
  let service: OnboardingService;
  let mockPrisma: any;
  let mockAudit: any;

  beforeEach(() => {
    mockAudit = {
      log: vi.fn().mockResolvedValue(undefined),
    };

    mockPrisma = {
      systemInstallation: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'inst-1',
          installationKey: 'MEDIX-TEST-001',
          appVersion: '1.0.0',
          systemName: 'Medix by FARMAX',
          isInitialized: false,
        }),
        create: vi.fn(),
        update: vi.fn().mockResolvedValue({
          id: 'inst-1',
          isInitialized: true,
          installationKey: 'MEDIX-TEST-001',
          appVersion: '1.0.0',
        }),
      },
      organization: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'org-1',
          name: 'Medix Pharma',
          ntn: '1234567-8',
          drugSaleLicenseNo: 'DSL-001',
        }),
      },
      branch: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'br-1', isHeadOffice: true, isActive: true },
        ]),
      },
      warehouse: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'wh-1', warehouseType: 'STANDARD', isActive: true },
          { id: 'wh-2', warehouseType: 'QUARANTINE', isActive: true },
        ]),
      },
      user: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'u-1',
            status: 'ACTIVE',
            userRoles: [{ role: { name: 'ADMIN' } }],
          },
        ]),
      },
      product: { count: vi.fn().mockResolvedValue(10) },
      customer: { count: vi.fn().mockResolvedValue(5) },
      supplier: { count: vi.fn().mockResolvedValue(3) },
      productCategory: { count: vi.fn().mockResolvedValue(4) },
      manufacturer: { count: vi.fn().mockResolvedValue(2) },
      unitOfMeasurement: { count: vi.fn().mockResolvedValue(3) },
      customerLedgerEntry: {
        findMany: vi.fn().mockResolvedValue([{ debit: 5000, customerId: 'c-1' }]),
      },
      supplierLedgerEntry: {
        findMany: vi.fn().mockResolvedValue([{ credit: 8000, supplierId: 's-1' }]),
      },
      stockMovement: {
        findMany: vi.fn().mockResolvedValue([{ quantity: 50, unitCost: 100 }]),
      },
      batch: { count: vi.fn().mockResolvedValue(2) },
      systemSetting: { count: vi.fn().mockResolvedValue(8) },
      numberingSeries: { count: vi.fn().mockResolvedValue(10) },
    };

    service = new OnboardingService(
      mockPrisma as unknown as PrismaService,
      mockAudit as unknown as AuditService,
    );
  });

  it('should calculate onboarding progress and steps status correctly', async () => {
    const status = await service.getStatus();

    expect(status.isInitialized).toBe(false);
    expect(status.steps.businessProfile.completed).toBe(true);
    expect(status.steps.branchAndWarehouse.completed).toBe(true);
    expect(status.steps.users.completed).toBe(true);
    expect(status.steps.masterData.completed).toBe(true);
    expect(status.steps.openingBalances.completed).toBe(true);
    expect(status.steps.openingStock.completed).toBe(true);
    expect(status.steps.systemReadiness.completed).toBe(true);
    expect(status.overallProgress).toBe(100);
    expect(status.summary.canComplete).toBe(true);
  });

  it('should complete onboarding and record audit event', async () => {
    const result = await service.completeOnboarding('user-1');

    expect(mockPrisma.systemInstallation.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ isInitialized: true }),
      }),
    );
    expect(mockAudit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'COMPLETE_ONBOARDING' }),
    );
  });

  it('should reset onboarding when requested', async () => {
    await service.resetOnboarding('user-1');

    expect(mockPrisma.systemInstallation.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ isInitialized: false }),
      }),
    );
    expect(mockAudit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'RESET_ONBOARDING' }),
    );
  });
});
