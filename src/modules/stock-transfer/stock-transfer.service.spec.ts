import { describe, it, expect, beforeEach, vi } from 'vitest';
import { StockTransferService } from './stock-transfer.service';
import { BadRequestException } from '@nestjs/common';
import { StockTransferStatus, StockMovementType, DocumentType } from '@prisma/client';

describe('StockTransferService', () => {
  let service: StockTransferService;
  let prisma: any;
  let auditService: any;
  let numberingService: any;
  let fefoService: any;

  const mockOrg = { id: 'org-1', name: 'Farmax Pharma' };
  const mockSourceWarehouse = {
    id: 'wh-1',
    branchId: 'br-1',
    name: 'Main Distribution Hub',
    code: 'WH-MAIN',
    warehouseType: 'STANDARD',
  };
  const mockDestWarehouse = {
    id: 'wh-2',
    branchId: 'br-1',
    name: 'Branch Retail Warehouse',
    code: 'WH-BR01',
    warehouseType: 'STANDARD',
  };
  const mockQuarantineWarehouse = {
    id: 'wh-quar',
    branchId: 'br-1',
    name: 'Quarantine Section',
    code: 'WH-QUAR',
    warehouseType: 'QUARANTINE',
  };

  const mockProduct = {
    id: 'prod-1',
    sku: 'PAN-500',
    name: 'Panadol 500mg',
  };

  const mockBatch = {
    id: 'batch-1',
    productId: 'prod-1',
    batchNumber: 'BN-1001',
    expiryDate: new Date('2028-12-31'),
    purchaseCost: 40.0,
    tradePrice: 50.0,
    retailPrice: 60.0,
    status: 'ACTIVE',
  };

  beforeEach(() => {
    prisma = {
      organization: {
        findFirst: vi.fn().mockResolvedValue(mockOrg),
      },
      warehouse: {
        findFirst: vi.fn().mockImplementation(({ where }) => {
          if (where.id === 'wh-1') return Promise.resolve(mockSourceWarehouse);
          if (where.id === 'wh-2') return Promise.resolve(mockDestWarehouse);
          if (where.id === 'wh-quar') return Promise.resolve(mockQuarantineWarehouse);
          return Promise.resolve(null);
        }),
      },
      batch: {
        findMany: vi.fn().mockResolvedValue([mockBatch]),
      },
      stockTransfer: {
        findFirst: vi.fn(),
        findMany: vi.fn(),
        count: vi.fn().mockResolvedValue(1),
        create: vi.fn(),
        update: vi.fn(),
      },
      stockTransferItem: {
        deleteMany: vi.fn(),
        createMany: vi.fn(),
        update: vi.fn(),
        findMany: vi.fn(),
      },
      stockMovement: {
        findMany: vi.fn(),
        create: vi.fn(),
      },
      $transaction: vi.fn((cb) => cb(prisma)),
      $queryRaw: vi.fn().mockResolvedValue([]),
    };

    auditService = {
      log: vi.fn().mockResolvedValue(undefined),
    };

    numberingService = {
      generateNextNumber: vi.fn().mockResolvedValue({
        documentNumber: 'TRF-00001',
        seriesId: 'series-1',
        sequence: 1,
      }),
    };

    fefoService = {
      allocate: vi.fn(),
    };

    service = new StockTransferService(
      prisma,
      auditService,
      numberingService,
      fefoService,
    );
  });

  describe('createDraft', () => {
    it('creates a draft stock transfer without creating any StockMovements', async () => {
      const createdTransfer = {
        id: 'trf-1',
        organizationId: 'org-1',
        branchId: 'br-1',
        transferNumber: 'TRF-00001',
        sourceWarehouseId: 'wh-1',
        destinationWarehouseId: 'wh-2',
        status: StockTransferStatus.DRAFT,
        items: [
          {
            id: 'item-1',
            productId: 'prod-1',
            batchId: 'batch-1',
            requestedQuantity: 50,
            dispatchedQuantity: 0,
            receivedQuantity: 0,
          },
        ],
      };

      prisma.stockTransfer.create.mockResolvedValue(createdTransfer);
      prisma.stockTransfer.findFirst.mockResolvedValue(createdTransfer);

      const result = await service.createDraft(
        {
          sourceWarehouseId: 'wh-1',
          destinationWarehouseId: 'wh-2',
          items: [
            {
              productId: 'prod-1',
              batchId: 'batch-1',
              requestedQuantity: 50,
            },
          ],
        },
        'user-1',
      );

      expect(numberingService.generateNextNumber).toHaveBeenCalledWith(
        DocumentType.STOCK_TRANSFER,
        'br-1',
      );
      expect(prisma.stockMovement.create).not.toHaveBeenCalled();
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'CREATE_STOCK_TRANSFER_DRAFT',
        }),
      );
      expect(result.status).toBe(StockTransferStatus.DRAFT);
    });

    it('rejects transfer when source and destination warehouse are identical', async () => {
      await expect(
        service.createDraft({
          sourceWarehouseId: 'wh-1',
          destinationWarehouseId: 'wh-1',
          items: [{ productId: 'prod-1', batchId: 'batch-1', requestedQuantity: 10 }],
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('dispatchTransfer', () => {
    it('deducts stock from source warehouse and marks status DISPATCHED', async () => {
      const draftTransfer = {
        id: 'trf-1',
        organizationId: 'org-1',
        branchId: 'br-1',
        transferNumber: 'TRF-00001',
        sourceWarehouseId: 'wh-1',
        destinationWarehouseId: 'wh-2',
        status: StockTransferStatus.DRAFT,
        sourceWarehouse: mockSourceWarehouse,
        destinationWarehouse: mockDestWarehouse,
        items: [
          {
            id: 'item-1',
            productId: 'prod-1',
            batchId: 'batch-1',
            batchNumber: 'BN-1001',
            requestedQuantity: 30,
            dispatchedQuantity: 0,
            unitCost: 40.0,
            batch: mockBatch,
            product: mockProduct,
          },
        ],
      };

      prisma.stockTransfer.findFirst
        .mockResolvedValueOnce(draftTransfer)
        .mockResolvedValueOnce({
          ...draftTransfer,
          status: StockTransferStatus.DISPATCHED,
        });

      // Source warehouse currently has 100 units of physical stock
      prisma.stockMovement.findMany.mockResolvedValue([{ quantity: 100 }]);

      await service.dispatchTransfer('trf-1', {}, 'user-1');

      // Check negative StockMovement was created for source warehouse
      expect(prisma.stockMovement.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          organizationId: 'org-1',
          warehouseId: 'wh-1',
          batchId: 'batch-1',
          movementType: StockMovementType.TRANSFER_OUT,
          quantity: -30,
          referenceType: 'STOCK_TRANSFER',
          referenceId: 'trf-1',
        }),
      });

      expect(prisma.stockTransfer.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'trf-1' },
          data: expect.objectContaining({
            status: StockTransferStatus.DISPATCHED,
            dispatchedById: 'user-1',
          }),
        }),
      );

      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'DISPATCH_STOCK_TRANSFER',
        }),
      );
    });

    it('rejects dispatch when source warehouse has insufficient physical stock', async () => {
      const draftTransfer = {
        id: 'trf-1',
        organizationId: 'org-1',
        branchId: 'br-1',
        transferNumber: 'TRF-00001',
        sourceWarehouseId: 'wh-1',
        destinationWarehouseId: 'wh-2',
        status: StockTransferStatus.DRAFT,
        sourceWarehouse: mockSourceWarehouse,
        destinationWarehouse: mockDestWarehouse,
        items: [
          {
            id: 'item-1',
            productId: 'prod-1',
            batchId: 'batch-1',
            batchNumber: 'BN-1001',
            requestedQuantity: 50,
            dispatchedQuantity: 0,
            unitCost: 40.0,
            batch: mockBatch,
            product: mockProduct,
          },
        ],
      };

      prisma.stockTransfer.findFirst.mockResolvedValue(draftTransfer);
      // Source warehouse only has 20 units
      prisma.stockMovement.findMany.mockResolvedValue([{ quantity: 20 }]);

      await expect(
        service.dispatchTransfer('trf-1', {}, 'user-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects dispatching quarantined or expired batches into a STANDARD warehouse', async () => {
      const quarantinedBatch = {
        ...mockBatch,
        status: 'QUARANTINED',
      };

      const draftTransfer = {
        id: 'trf-1',
        organizationId: 'org-1',
        branchId: 'br-1',
        transferNumber: 'TRF-00001',
        sourceWarehouseId: 'wh-1',
        destinationWarehouseId: 'wh-2', // Destination is STANDARD
        status: StockTransferStatus.DRAFT,
        sourceWarehouse: mockSourceWarehouse,
        destinationWarehouse: mockDestWarehouse,
        items: [
          {
            id: 'item-1',
            productId: 'prod-1',
            batchId: 'batch-1',
            batchNumber: 'BN-1001',
            requestedQuantity: 10,
            dispatchedQuantity: 0,
            unitCost: 40.0,
            batch: quarantinedBatch,
            product: mockProduct,
          },
        ],
      };

      prisma.stockTransfer.findFirst.mockResolvedValue(draftTransfer);

      await expect(
        service.dispatchTransfer('trf-1', {}, 'user-1'),
      ).rejects.toThrow(/cannot be transferred into a STANDARD saleable warehouse/);
    });
  });

  describe('receiveTransfer', () => {
    it('receives partial quantities and transitions to PARTIALLY_RECEIVED', async () => {
      const dispatchedTransfer = {
        id: 'trf-1',
        organizationId: 'org-1',
        branchId: 'br-1',
        transferNumber: 'TRF-00001',
        sourceWarehouseId: 'wh-1',
        destinationWarehouseId: 'wh-2',
        status: StockTransferStatus.DISPATCHED,
        sourceWarehouse: mockSourceWarehouse,
        destinationWarehouse: mockDestWarehouse,
        items: [
          {
            id: 'item-1',
            productId: 'prod-1',
            batchId: 'batch-1',
            batchNumber: 'BN-1001',
            requestedQuantity: 50,
            dispatchedQuantity: 50,
            receivedQuantity: 0,
            unitCost: 40.0,
            batch: mockBatch,
            product: mockProduct,
          },
        ],
      };

      prisma.stockTransfer.findFirst
        .mockResolvedValueOnce(dispatchedTransfer)
        .mockResolvedValueOnce({
          ...dispatchedTransfer,
          status: StockTransferStatus.PARTIALLY_RECEIVED,
        });

      // Partial receiving simulation: 20 out of 50 received
      prisma.stockTransferItem.findMany.mockResolvedValue([
        { id: 'item-1', dispatchedQuantity: 50, receivedQuantity: 20 },
      ]);

      await service.receiveTransfer(
        'trf-1',
        {
          items: [{ itemId: 'item-1', receivedQuantity: 20 }],
        },
        'user-1',
      );

      // Verify positive StockMovement into destination warehouse
      expect(prisma.stockMovement.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          organizationId: 'org-1',
          warehouseId: 'wh-2',
          batchId: 'batch-1',
          movementType: StockMovementType.TRANSFER_IN,
          quantity: 20,
          referenceType: 'STOCK_TRANSFER',
          referenceId: 'trf-1',
        }),
      });

      expect(prisma.stockTransfer.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'trf-1' },
          data: expect.objectContaining({
            status: StockTransferStatus.PARTIALLY_RECEIVED,
          }),
        }),
      );
    });

    it('transitions to RECEIVED when all dispatched quantities are fully received', async () => {
      const partiallyReceivedTransfer = {
        id: 'trf-1',
        organizationId: 'org-1',
        branchId: 'br-1',
        transferNumber: 'TRF-00001',
        sourceWarehouseId: 'wh-1',
        destinationWarehouseId: 'wh-2',
        status: StockTransferStatus.PARTIALLY_RECEIVED,
        sourceWarehouse: mockSourceWarehouse,
        destinationWarehouse: mockDestWarehouse,
        items: [
          {
            id: 'item-1',
            productId: 'prod-1',
            batchId: 'batch-1',
            batchNumber: 'BN-1001',
            requestedQuantity: 50,
            dispatchedQuantity: 50,
            receivedQuantity: 20,
            unitCost: 40.0,
            batch: mockBatch,
            product: mockProduct,
          },
        ],
      };

      prisma.stockTransfer.findFirst
        .mockResolvedValueOnce(partiallyReceivedTransfer)
        .mockResolvedValueOnce({
          ...partiallyReceivedTransfer,
          status: StockTransferStatus.RECEIVED,
        });

      // Receiving remaining 30 units (20 + 30 = 50)
      prisma.stockTransferItem.findMany.mockResolvedValue([
        { id: 'item-1', dispatchedQuantity: 50, receivedQuantity: 50 },
      ]);

      await service.receiveTransfer(
        'trf-1',
        {
          items: [{ itemId: 'item-1', receivedQuantity: 30 }],
        },
        'user-1',
      );

      expect(prisma.stockTransfer.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'trf-1' },
          data: expect.objectContaining({
            status: StockTransferStatus.RECEIVED,
            receivedById: 'user-1',
          }),
        }),
      );
    });

    it('rejects receiving more than pending in-transit quantity', async () => {
      const dispatchedTransfer = {
        id: 'trf-1',
        organizationId: 'org-1',
        branchId: 'br-1',
        transferNumber: 'TRF-00001',
        sourceWarehouseId: 'wh-1',
        destinationWarehouseId: 'wh-2',
        status: StockTransferStatus.DISPATCHED,
        sourceWarehouse: mockSourceWarehouse,
        destinationWarehouse: mockDestWarehouse,
        items: [
          {
            id: 'item-1',
            productId: 'prod-1',
            batchId: 'batch-1',
            batchNumber: 'BN-1001',
            requestedQuantity: 20,
            dispatchedQuantity: 20,
            receivedQuantity: 0,
            unitCost: 40.0,
            batch: mockBatch,
            product: mockProduct,
          },
        ],
      };

      prisma.stockTransfer.findFirst.mockResolvedValue(dispatchedTransfer);

      // Attempt to receive 25 when only 20 were dispatched
      await expect(
        service.receiveTransfer(
          'trf-1',
          {
            items: [{ itemId: 'item-1', receivedQuantity: 25 }],
          },
          'user-1',
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('cancelTransfer', () => {
    it('cancels DRAFT transfer without any stock movement entries', async () => {
      const draftTransfer = {
        id: 'trf-1',
        organizationId: 'org-1',
        branchId: 'br-1',
        transferNumber: 'TRF-00001',
        sourceWarehouseId: 'wh-1',
        destinationWarehouseId: 'wh-2',
        status: StockTransferStatus.DRAFT,
        sourceWarehouse: mockSourceWarehouse,
        destinationWarehouse: mockDestWarehouse,
        items: [],
      };

      prisma.stockTransfer.findFirst
        .mockResolvedValueOnce(draftTransfer)
        .mockResolvedValueOnce({
          ...draftTransfer,
          status: StockTransferStatus.CANCELLED,
        });

      prisma.stockTransfer.update.mockResolvedValue({
        ...draftTransfer,
        status: StockTransferStatus.CANCELLED,
      });

      await service.cancelTransfer(
        'trf-1',
        { cancellationReason: 'Wrong destination selected' },
        'user-1',
      );

      expect(prisma.stockMovement.create).not.toHaveBeenCalled();
      expect(prisma.stockTransfer.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'trf-1' },
          data: expect.objectContaining({
            status: StockTransferStatus.CANCELLED,
            cancellationReason: 'Wrong destination selected',
          }),
        }),
      );
    });

    it('cancels DISPATCHED transfer and restores in-transit stock back to source warehouse', async () => {
      const dispatchedTransfer = {
        id: 'trf-1',
        organizationId: 'org-1',
        branchId: 'br-1',
        transferNumber: 'TRF-00001',
        sourceWarehouseId: 'wh-1',
        destinationWarehouseId: 'wh-2',
        status: StockTransferStatus.DISPATCHED,
        sourceWarehouse: mockSourceWarehouse,
        destinationWarehouse: mockDestWarehouse,
        items: [
          {
            id: 'item-1',
            productId: 'prod-1',
            batchId: 'batch-1',
            batchNumber: 'BN-1001',
            requestedQuantity: 40,
            dispatchedQuantity: 40,
            receivedQuantity: 0,
            unitCost: 40.0,
            batch: mockBatch,
          },
        ],
      };

      prisma.stockTransfer.findFirst
        .mockResolvedValueOnce(dispatchedTransfer)
        .mockResolvedValueOnce({
          ...dispatchedTransfer,
          status: StockTransferStatus.CANCELLED,
        });

      await service.cancelTransfer(
        'trf-1',
        { cancellationReason: 'Vehicle breakdown before transit' },
        'user-1',
      );

      // Verify compensating TRANSFER_IN stock movement restoring 40 units to source warehouse
      expect(prisma.stockMovement.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          organizationId: 'org-1',
          warehouseId: 'wh-1',
          batchId: 'batch-1',
          movementType: StockMovementType.TRANSFER_IN,
          quantity: 40,
          referenceType: 'STOCK_TRANSFER_REVERSAL',
          referenceId: 'trf-1',
        }),
      });
    });

    it('cancels PARTIALLY_RECEIVED transfer by restoring in-transit and reversing received destination stock', async () => {
      const partiallyReceivedTransfer = {
        id: 'trf-1',
        organizationId: 'org-1',
        branchId: 'br-1',
        transferNumber: 'TRF-00001',
        sourceWarehouseId: 'wh-1',
        destinationWarehouseId: 'wh-2',
        status: StockTransferStatus.PARTIALLY_RECEIVED,
        sourceWarehouse: mockSourceWarehouse,
        destinationWarehouse: mockDestWarehouse,
        items: [
          {
            id: 'item-1',
            productId: 'prod-1',
            batchId: 'batch-1',
            batchNumber: 'BN-1001',
            requestedQuantity: 50,
            dispatchedQuantity: 50,
            receivedQuantity: 20, // 20 received into dest, 30 in transit
            unitCost: 40.0,
            batch: mockBatch,
          },
        ],
      };

      prisma.stockTransfer.findFirst
        .mockResolvedValueOnce(partiallyReceivedTransfer)
        .mockResolvedValueOnce({
          ...partiallyReceivedTransfer,
          status: StockTransferStatus.CANCELLED,
        });

      // Destination warehouse has 20 units available
      prisma.stockMovement.findMany.mockResolvedValue([{ quantity: 20 }]);

      await service.cancelTransfer(
        'trf-1',
        { cancellationReason: 'Emergency recall' },
        'user-1',
      );

      // 1. In-transit 30 restored to source
      expect(prisma.stockMovement.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          warehouseId: 'wh-1',
          quantity: 30,
          movementType: StockMovementType.TRANSFER_IN,
        }),
      });

      // 2. Received 20 deducted from destination
      expect(prisma.stockMovement.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          warehouseId: 'wh-2',
          quantity: -20,
          movementType: StockMovementType.TRANSFER_OUT,
        }),
      });

      // 3. Received 20 restored back to source
      expect(prisma.stockMovement.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          warehouseId: 'wh-1',
          quantity: 20,
          movementType: StockMovementType.TRANSFER_IN,
        }),
      });
    });
  });

  describe('getMetrics', () => {
    it('returns transfer KPIs for dashboard and register summary', async () => {
      prisma.stockTransfer.count
        .mockResolvedValueOnce(10) // total
        .mockResolvedValueOnce(2) // draft
        .mockResolvedValueOnce(3) // in transit
        .mockResolvedValueOnce(4) // received
        .mockResolvedValueOnce(1); // cancelled

      const metrics = await service.getMetrics('br-1');

      expect(metrics).toEqual({
        totalTransfers: 10,
        draftCount: 2,
        inTransitCount: 3,
        receivedCount: 4,
        cancelledCount: 1,
      });
    });
  });
});
