import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

export interface FefoAllocationRequest {
  organizationId: string;
  branchId: string;
  warehouseId: string;
  productId: string;
  requestedQuantity: number;
}

export interface FefoBatchAllocation {
  batchId: string;
  batchNumber: string;
  mfgDate: Date | null;
  expiryDate: Date;
  allocatedQuantity: number;
  availableQuantity: number;
  purchaseCost: number;
  tradePrice: number;
  retailPrice: number;
}

export interface FefoAllocationResult {
  productId: string;
  warehouseId: string;
  requestedQuantity: number;
  allocatedQuantity: number;
  shortfall: number;
  isFullyAllocated: boolean;
  allocations: FefoBatchAllocation[];
}

@Injectable()
export class FefoService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Reusable core domain service for First-Expired, First-Out (FEFO) batch allocation.
   * Only ACTIVE, non-expired batches with positive warehouse balance are considered.
   * Batches are sorted strictly by expiryDate ASC, then createdAt ASC.
   */
  async allocate(params: FefoAllocationRequest): Promise<FefoAllocationResult> {
    const { organizationId, branchId, warehouseId, productId, requestedQuantity } = params;

    if (requestedQuantity <= 0) {
      throw new BadRequestException('Requested allocation quantity must be greater than zero');
    }

    const now = new Date();

    // 1. Fetch active, non-expired batches for the product with positive movement balances
    const candidateBatches = await this.prisma.batch.findMany({
      where: {
        productId,
        product: { organizationId },
        status: 'ACTIVE',
        expiryDate: { gt: now },
      },
      orderBy: [{ expiryDate: 'asc' }, { createdAt: 'asc' }],
      select: {
        id: true,
        batchNumber: true,
        mfgDate: true,
        expiryDate: true,
        purchaseCost: true,
        tradePrice: true,
        retailPrice: true,
        stockMovements: {
          where: {
            organizationId,
            branchId,
            warehouseId,
          },
          select: {
            quantity: true,
          },
        },
      },
    });

    let remainingNeeded = requestedQuantity;
    let totalAllocated = 0;
    const allocations: FefoBatchAllocation[] = [];

    for (const batch of candidateBatches) {
      if (remainingNeeded <= 0) break;

      // Sum signed quantities from ledger
      const availableQty = batch.stockMovements.reduce(
        (sum, m) => sum + m.quantity,
        0,
      );

      if (availableQty <= 0) {
        continue;
      }

      const qtyToAllocate = Math.min(remainingNeeded, availableQty);

      allocations.push({
        batchId: batch.id,
        batchNumber: batch.batchNumber,
        mfgDate: batch.mfgDate,
        expiryDate: batch.expiryDate,
        allocatedQuantity: qtyToAllocate,
        availableQuantity: availableQty,
        purchaseCost: Number(batch.purchaseCost),
        tradePrice: Number(batch.tradePrice),
        retailPrice: Number(batch.retailPrice),
      });

      remainingNeeded -= qtyToAllocate;
      totalAllocated += qtyToAllocate;
    }

    return {
      productId,
      warehouseId,
      requestedQuantity,
      allocatedQuantity: totalAllocated,
      shortfall: remainingNeeded,
      isFullyAllocated: remainingNeeded === 0,
      allocations,
    };
  }
}
