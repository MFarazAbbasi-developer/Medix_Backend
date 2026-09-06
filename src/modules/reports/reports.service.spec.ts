import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ReportsService } from './reports.service';
import { ReportExportFormat } from './dto/query-reports.dto';
import {
  SalesInvoiceStatus,
  SalesReturnStatus,
  GrnStatus,
  CustomerPaymentStatus,
  CustomerLedgerEntryType,
  StockMovementType,
  WarehouseType,
  BatchStatus,
} from '@prisma/client';

describe('ReportsService', () => {
  let service: ReportsService;
  let prisma: any;

  const mockOrg = { id: 'org-1', name: 'Medix Pharma' };

  beforeEach(() => {
    prisma = {
      organization: {
        findFirst: vi.fn().mockResolvedValue(mockOrg),
      },
      salesInvoice: {
        findMany: vi.fn(),
      },
      salesInvoiceItem: {
        findMany: vi.fn(),
      },
      salesReturn: {
        findMany: vi.fn(),
      },
      goodsReceiveNote: {
        findMany: vi.fn(),
      },
      goodsReceiveNoteItem: {
        findMany: vi.fn(),
      },
      customerPayment: {
        findMany: vi.fn(),
      },
      customer: {
        findMany: vi.fn(),
        findFirst: vi.fn(),
        findUnique: vi.fn(),
      },
      supplier: {
        findMany: vi.fn(),
        findFirst: vi.fn(),
        findUnique: vi.fn(),
      },
      customerLedgerEntry: {
        findMany: vi.fn(),
      },
      supplierLedgerEntry: {
        findMany: vi.fn(),
      },
      batch: {
        findMany: vi.fn(),
      },
      stockMovement: {
        findMany: vi.fn(),
      },
      stockTransfer: {
        findMany: vi.fn(),
      },
    };

    service = new ReportsService(prisma as any);
  });

  describe('Sales Reports', () => {
    it('should generate sales summary excluding draft and cancelled invoices', async () => {
      prisma.salesInvoice.findMany.mockResolvedValue([
        {
          id: 'inv-1',
          subtotal: 1000,
          discountAmount: 100,
          taxAmount: 50,
          netTotal: 950,
          paidAmount: 500,
          balanceAmount: 450,
          status: SalesInvoiceStatus.POSTED,
          items: [
            { lineCost: 700, billedQuantity: 10, bonusQuantity: 0 },
          ],
        },
        {
          id: 'inv-2',
          subtotal: 2000,
          discountAmount: 200,
          taxAmount: 100,
          netTotal: 1900,
          paidAmount: 1900,
          balanceAmount: 0,
          status: SalesInvoiceStatus.POSTED,
          items: [
            { lineCost: 1300, billedQuantity: 20, bonusQuantity: 2 },
          ],
        },
      ]);

      const result = await service.getSalesSummary({
        startDate: '2026-01-01',
        endDate: '2026-01-31',
      });

      expect(result.invoiceCount).toBe(2);
      expect(result.grossSales).toBe(3000);
      expect(result.discountAmount).toBe(300);
      expect(result.taxAmount).toBe(150);
      expect(result.netSales).toBe(2850);
      expect(result.paidAmount).toBe(2400);
      expect(result.outstandingAmount).toBe(450);
      expect(result.totalCogs).toBe(2000);
      expect(result.grossProfit).toBe(850);
      expect(result.marginPercentage).toBe(29.82);
    });

    it('should generate product-wise sales report with historical COGS', async () => {
      prisma.salesInvoiceItem.findMany.mockResolvedValue([
        {
          id: 'item-1',
          productId: 'prod-1',
          batchId: 'batch-1',
          billedQuantity: 10,
          bonusQuantity: 1,
          totalQuantity: 11,
          unitPrice: 100,
          unitCost: 70,
          discountAmount: 50,
          taxAmount: 20,
          lineTotal: 970,
          lineCost: 700,
          product: {
            id: 'prod-1',
            name: 'Panadol Extra 500mg',
            sku: 'PAN-500',
            genericName: 'Paracetamol',
            manufacturer: { id: 'mfg-1', name: 'GSK' },
          },
          salesInvoice: {
            invoiceDate: new Date('2026-01-15'),
            status: SalesInvoiceStatus.POSTED,
          },
        },
      ]);

      const result = (await service.getProductWiseSales({})) as any;
      expect(result.totalCount).toBe(1);
      expect(result.data[0].name).toBe('Panadol Extra 500mg');
      expect(result.data[0].billedQuantity).toBe(10);
      expect(result.data[0].bonusQuantity).toBe(1);
      expect(result.data[0].netSales).toBe(970);
      expect(result.data[0].historicalCost).toBe(700);
      expect(result.data[0].grossProfit).toBe(270);
      expect(result.data[0].marginPercentage).toBe(27.84);
    });

    it('should export sales register to CSV format', async () => {
      prisma.salesInvoice.findMany.mockResolvedValue([
        {
          id: 'inv-1',
          invoiceNumber: 'INV-2026-0001',
          invoiceDate: new Date('2026-02-01'),
          paymentMethod: 'CREDIT_ACCOUNT',
          subtotal: 1000,
          discountAmount: 50,
          taxAmount: 25,
          netTotal: 975,
          paidAmount: 975,
          balanceAmount: 0,
          customer: { name: 'HealthPlus Pharmacy', code: 'CUST-001' },
          branch: { name: 'Main Branch' },
          warehouse: { name: 'Main Warehouse' },
          items: [{ lineCost: 750, billedQuantity: 10, bonusQuantity: 0 }],
        },
      ]);

      const result = (await service.getSalesRegister({
        format: ReportExportFormat.CSV,
      })) as any;

      expect(result).toHaveProperty('csv');
      expect(result.csv).toContain('"Invoice Number","Date","Customer Code","Customer Name"');
      expect(result.csv).toContain('INV-2026-0001');
      expect(result.csv).toContain('HealthPlus Pharmacy');
    });

    it('should generate sales returns report', async () => {
      prisma.salesReturn.findMany.mockResolvedValue([
        {
          id: 'ret-1',
          returnNumber: 'SR-2026-001',
          returnDate: new Date('2026-02-05'),
          status: SalesReturnStatus.POSTED,
          subtotal: 250,
          discountAmount: 0,
          taxAmount: 0,
          netTotal: 250,
          refundAmount: 250,
          refundMode: 'CREDIT_NOTE',
          reason: 'Damaged packaging',
          customer: { code: 'CUST-001', name: 'Care Pharmacy' },
          items: [
            {
              returnedQuantity: 2,
              product: { name: 'Amoxicillin 500mg' },
              batch: { batchNumber: 'BAT-01' },
            },
          ],
        },
      ]);

      const result = (await service.getSalesReturnsReport({})) as any;
      expect(result.totalCount).toBe(1);
      expect(result.data[0].netTotal).toBe(250);
      expect(result.data[0].returnNumber).toBe('SR-2026-001');
    });

    it('should generate collections report', async () => {
      prisma.customerPayment.findMany.mockResolvedValue([
        {
          id: 'pay-1',
          paymentNumber: 'REC-001',
          paymentDate: new Date('2026-02-10'),
          paymentMethod: 'BANK_TRANSFER',
          referenceNumber: 'TXN-987654',
          bankName: 'Meezan Bank',
          amount: 5000,
          allocatedAmount: 5000,
          unallocatedAmount: 0,
          status: CustomerPaymentStatus.POSTED,
          customer: { code: 'CUST-HOSP', name: 'City Hospital' },
        },
      ]);

      const result = (await service.getCollectionsReport({})) as any;
      expect(result.totalCount).toBe(1);
      expect(result.data[0].amount).toBe(5000);
      expect(result.data[0].paymentMethod).toBe('BANK_TRANSFER');
    });
  });

  describe('Purchase Reports', () => {
    it('should generate purchase summary', async () => {
      prisma.goodsReceiveNote.findMany.mockResolvedValue([
        {
          id: 'grn-1',
          subtotal: 5000,
          discountAmount: 200,
          taxAmount: 150,
          netTotal: 4950,
          paidAmount: 2000,
          balanceAmount: 2950,
          status: GrnStatus.POSTED,
          items: [
            { receivedQuantity: 50, bonusQuantity: 5 },
          ],
        },
      ]);

      const result = await service.getPurchaseSummary({});
      expect(result.grnCount).toBe(1);
      expect(result.grossPurchases).toBe(5000);
      expect(result.netPurchases).toBe(4950);
      expect(result.totalBilledQuantity).toBe(50);
      expect(result.totalBonusQuantity).toBe(5);
    });

    it('should generate supplier-wise purchases report', async () => {
      prisma.goodsReceiveNote.findMany.mockResolvedValue([
        {
          id: 'grn-1',
          supplierId: 'supp-1',
          subtotal: 10000,
          discountAmount: 0,
          taxAmount: 0,
          netTotal: 10000,
          paidAmount: 5000,
          balanceAmount: 5000,
          supplier: { id: 'supp-1', name: 'Novartis PK', code: 'SUPP-NOV' },
          items: [
            { receivedQuantity: 100, bonusQuantity: 10 },
          ],
        },
      ]);

      const result = (await service.getSupplierWisePurchases({})) as any;
      expect(result.totalCount).toBe(1);
      expect(result.data[0].supplierName).toBe('Novartis PK');
      expect(result.data[0].netPurchases).toBe(10000);
      expect(result.data[0].billedQuantity).toBe(100);
      expect(result.data[0].bonusQuantity).toBe(10);
    });
  });

  describe('Inventory & Expiry Reports', () => {
    it('should calculate stock valuation exclusively from StockMovement', async () => {
      prisma.batch.findMany.mockResolvedValue([
        {
          id: 'batch-1',
          batchNumber: 'BN-101',
          mfgDate: new Date('2025-01-01'),
          purchaseCost: 80,
          tradePrice: 95,
          retailPrice: 110,
          expiryDate: new Date('2027-01-01'),
          status: BatchStatus.ACTIVE,
          product: {
            id: 'prod-1',
            name: 'Disprin 300mg',
            sku: 'DISP-300',
            genericName: 'Aspirin',
            manufacturer: { name: 'Reckitt' },
            unit: { symbol: 'TAB' },
          },
          stockMovements: [
            {
              quantity: 100,
              warehouse: { id: 'wh-std', name: 'Main Store', warehouseType: WarehouseType.STANDARD },
            },
            {
              quantity: 20,
              warehouse: { id: 'wh-quar', name: 'Quarantine Section', warehouseType: WarehouseType.QUARANTINE },
            },
          ],
        },
      ]);

      const result = (await service.getStockValuationReport({})) as any;
      expect(result.summary.totalQuantity).toBe(120);
      expect(result.summary.standardQuantity).toBe(100);
      expect(result.summary.quarantineQuantity).toBe(20);
      expect(result.summary.purchaseValuation).toBe(120 * 80);
      expect(result.summary.retailValuation).toBe(120 * 110);
    });

    it('should generate stock ledger report with running balance', async () => {
      prisma.stockMovement.findMany.mockResolvedValue([
        {
          id: 'sm-1',
          movementDate: new Date('2026-01-01'),
          movementType: StockMovementType.PURCHASE_RECEIPT,
          quantity: 100,
          unitCost: 50,
          referenceType: 'GRN',
          referenceId: 'GRN-001',
          notes: 'Initial receipt',
          product: { sku: 'PAN-01', name: 'Panadol' },
          batch: { batchNumber: 'B1', expiryDate: new Date('2027-01-01') },
          warehouse: { name: 'Main Warehouse', warehouseType: 'STANDARD' },
          createdByUser: { displayName: 'Store Manager', username: 'store' },
        },
        {
          id: 'sm-2',
          movementDate: new Date('2026-01-02'),
          movementType: StockMovementType.SALES_ISSUE,
          quantity: -30,
          unitCost: 50,
          referenceType: 'INVOICE',
          referenceId: 'INV-001',
          notes: 'Customer sale',
          product: { sku: 'PAN-01', name: 'Panadol' },
          batch: { batchNumber: 'B1', expiryDate: new Date('2027-01-01') },
          warehouse: { name: 'Main Warehouse', warehouseType: 'STANDARD' },
          createdByUser: { displayName: 'Cashier', username: 'cashier' },
        },
      ]);

      const result = (await service.getStockLedgerReport({})) as any;
      expect(result.totalCount).toBe(2);
      expect(result.data[0].quantity).toBe(100);
      expect(result.data[1].quantity).toBe(-30);
    });
  });

  describe('Aging & Statement Reports', () => {
    it('should calculate customer aging buckets correctly (Current, 1-30, 31-60, 61-90, 90+)', async () => {
      const now = new Date();
      const tenDaysAgo = new Date(now.getTime() - 10 * 86400000);
      const fortyDaysAgo = new Date(now.getTime() - 40 * 86400000);

      prisma.customer.findMany.mockResolvedValue([
        {
          id: 'cust-1',
          name: 'Prime Pharmacy',
          code: 'CUST-001',
          customerType: 'RETAIL_PHARMACY',
          creditDays: 0,
          creditLimit: 50000,
          currentBalance: 3000,
          salesInvoices: [
            {
              id: 'inv-1',
              invoiceDate: tenDaysAgo,
              balanceAmount: 1000,
            },
            {
              id: 'inv-2',
              invoiceDate: fortyDaysAgo,
              balanceAmount: 2000,
            },
          ],
        },
      ]);

      const result = (await service.getCustomerAgingReport({})) as any;
      expect(result.summary.grandTotalDue).toBe(3000);
      expect(result.data[0].days1to30).toBe(1000);
      expect(result.data[0].days31to60).toBe(2000);
      expect(result.data[0].days61to90).toBe(0);
      expect(result.data[0].days90Plus).toBe(0);
    });

    it('should generate chronological customer statement with running balance', async () => {
      prisma.customer.findFirst.mockResolvedValue({
        id: 'cust-1',
        name: 'Prime Pharmacy',
        code: 'CUST-001',
        currentBalance: 1500,
      });

      prisma.customerLedgerEntry.findMany.mockResolvedValue([
        {
          id: 'cle-1',
          transactionDate: new Date('2026-01-05'),
          entryType: CustomerLedgerEntryType.SALES_INVOICE,
          referenceNumber: 'INV-100',
          notes: 'Sales Invoice',
          debit: 2000,
          credit: 0,
        },
        {
          id: 'cle-2',
          transactionDate: new Date('2026-01-10'),
          entryType: CustomerLedgerEntryType.PAYMENT,
          referenceNumber: 'REC-100',
          notes: 'Customer Payment',
          debit: 0,
          credit: 500,
        },
      ]);

      const result = (await service.getCustomerStatement('cust-1', {})) as any;
      expect(result.openingBalance).toBe(0);
      expect(result.closingBalance).toBe(1500);
      expect(result.data[0].runningBalance).toBe(2000);
      expect(result.data[1].runningBalance).toBe(1500);
    });
  });

  describe('Profitability & Operational Dashboard', () => {
    it('should calculate gross profit and margin percentage safely from historical lineCost', async () => {
      prisma.salesInvoice.findMany.mockResolvedValue([
        {
          id: 'inv-1',
          netTotal: 1000,
          discountAmount: 100,
          taxAmount: 50,
          items: [{ lineCost: 750 }],
        },
      ]);

      const result = await service.getProfitabilitySummary({});
      expect(result.netRevenue).toBe(1000);
      expect(result.totalCogs).toBe(750);
      expect(result.grossProfit).toBe(250);
      expect(result.marginPercentage).toBe(25);
    });

    it('should compute operational dashboard KPIs correctly', async () => {
      prisma.salesInvoice.findMany
        .mockResolvedValueOnce([
          { netTotal: 1000, items: [{ lineCost: 600 }] },
        ]) // today invoices
        .mockResolvedValueOnce([
          { netTotal: 5000, items: [{ lineCost: 3000 }] },
        ]); // month invoices

      prisma.goodsReceiveNote.findMany.mockResolvedValue([
        { netTotal: 2500 },
      ]);

      prisma.customerPayment.findMany.mockResolvedValue([
        { amount: 800 },
      ]);

      prisma.customer.findMany.mockResolvedValue([
        { currentBalance: 4000 },
      ]);

      prisma.supplier.findMany.mockResolvedValue([
        { currentBalance: 3200 },
      ]);

      prisma.stockMovement.findMany.mockResolvedValue([
        { quantity: 15 },
      ]);

      prisma.stockTransfer.findMany.mockResolvedValue([
        {
          items: [{ dispatchedQuantity: 50, receivedQuantity: 30 }],
        },
      ]);

      prisma.batch.findMany.mockResolvedValue([]);

      const metrics = await service.getDashboardMetrics();
      expect(metrics.today.salesNet).toBe(1000);
      expect(metrics.today.grossProfit).toBe(400);
      expect(metrics.today.purchasesNet).toBe(2500);
      expect(metrics.today.collections).toBe(800);
      expect(metrics.outstanding.receivables).toBe(4000);
      expect(metrics.outstanding.payables).toBe(3200);
      expect(metrics.inventory.quarantinedUnits).toBe(15);
      expect(metrics.inventory.inTransitUnits).toBe(20);
    });
  });
});
