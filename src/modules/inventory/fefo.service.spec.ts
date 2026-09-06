import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FefoService } from './fefo.service';
import { PrismaService } from '../../prisma/prisma.service';
import { BadRequestException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';

describe('FefoService', () => {
  let service: FefoService;
  let prisma: PrismaService;

  beforeEach(() => {
    prisma = {
      warehouse: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'wh-1',
          name: 'Main Warehouse',
          warehouseType: 'STANDARD',
        }),
      },
      batch: {
        findMany: vi.fn(),
      },
    } as unknown as PrismaService;

    service = new FefoService(prisma);
  });

  it('should allocate stock across batches in strict FEFO expiry order', async () => {
    const futureDate1 = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 1 month
    const futureDate2 = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000); // 3 months

    const mockBatches = [
      {
        id: 'batch-1',
        batchNumber: 'LOT-EXP-EARLY',
        mfgDate: new Date('2025-01-01'),
        expiryDate: futureDate1,
        purchaseCost: new Decimal('100.00'),
        tradePrice: new Decimal('120.00'),
        retailPrice: new Decimal('140.00'),
        stockMovements: [{ quantity: 50 }], // 50 available
      },
      {
        id: 'batch-2',
        batchNumber: 'LOT-EXP-LATER',
        mfgDate: new Date('2025-02-01'),
        expiryDate: futureDate2,
        purchaseCost: new Decimal('105.00'),
        tradePrice: new Decimal('125.00'),
        retailPrice: new Decimal('145.00'),
        stockMovements: [{ quantity: 100 }], // 100 available
      },
    ];

    vi.spyOn(prisma.batch, 'findMany').mockResolvedValue(mockBatches as any);

    // Request 70 units: should take all 50 from batch-1 and 20 from batch-2
    const result = await service.allocate({
      organizationId: 'org-1',
      branchId: 'branch-1',
      warehouseId: 'wh-1',
      productId: 'prod-1',
      requestedQuantity: 70,
    });

    expect(result.isFullyAllocated).toBe(true);
    expect(result.allocatedQuantity).toBe(70);
    expect(result.shortfall).toBe(0);
    expect(result.allocations).toHaveLength(2);

    expect(result.allocations[0].batchId).toBe('batch-1');
    expect(result.allocations[0].allocatedQuantity).toBe(50);

    expect(result.allocations[1].batchId).toBe('batch-2');
    expect(result.allocations[1].allocatedQuantity).toBe(20);
  });

  it('should calculate shortfall when requested quantity exceeds available stock', async () => {
    const futureDate = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000);

    const mockBatches = [
      {
        id: 'batch-1',
        batchNumber: 'LOT-1',
        mfgDate: null,
        expiryDate: futureDate,
        purchaseCost: new Decimal('50.00'),
        tradePrice: new Decimal('60.00'),
        retailPrice: new Decimal('70.00'),
        stockMovements: [{ quantity: 15 }], // only 15 available
      },
    ];

    vi.spyOn(prisma.batch, 'findMany').mockResolvedValue(mockBatches as any);

    const result = await service.allocate({
      organizationId: 'org-1',
      branchId: 'branch-1',
      warehouseId: 'wh-1',
      productId: 'prod-1',
      requestedQuantity: 50,
    });

    expect(result.isFullyAllocated).toBe(false);
    expect(result.allocatedQuantity).toBe(15);
    expect(result.shortfall).toBe(35);
  });

  it('should reject invalid requested quantity <= 0', async () => {
    await expect(
      service.allocate({
        organizationId: 'org-1',
        branchId: 'branch-1',
        warehouseId: 'wh-1',
        productId: 'prod-1',
        requestedQuantity: 0,
      }),
    ).rejects.toThrow(BadRequestException);
  });
});
