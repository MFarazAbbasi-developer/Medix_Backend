import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { ExportDatasetDto } from '../dto/data-export.dto';

@Injectable()
export class DataExportService {
  private readonly logger = new Logger(DataExportService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Escape and format CSV fields following RFC 4180.
   */
  private formatCsvRow(fields: (string | number | boolean | null | undefined)[]): string {
    return fields
      .map((field) => {
        if (field === null || field === undefined) {
          return '""';
        }
        const str = String(field);
        if (str.includes('"') || str.includes(',') || str.includes('\n') || str.includes('\r')) {
          return `"${str.replace(/"/g, '""')}"`;
        }
        return `"${str}"`;
      })
      .join(',');
  }

  /**
   * Convert array of objects to CSV string.
   */
  private generateCsv(headers: string[], rows: (string | number | boolean | null | undefined)[][]): string {
    const headerLine = this.formatCsvRow(headers);
    const dataLines = rows.map((r) => this.formatCsvRow(r));
    return [headerLine, ...dataLines].join('\r\n');
  }

  /**
   * Main dataset exporter.
   */
  async exportDataset(dto: ExportDatasetDto) {
    const timestamp = new Date().toISOString().replace(/:/g, '-').slice(0, 19);

    switch (dto.dataset) {
      case 'products':
        return this.exportProducts(timestamp);
      case 'batches':
        return this.exportBatches(timestamp);
      case 'customers':
        return this.exportCustomers(timestamp);
      case 'suppliers':
        return this.exportSuppliers(timestamp);
      case 'sales_invoices':
        return this.exportSalesInvoices(dto, timestamp);
      case 'purchases':
        return this.exportPurchases(dto, timestamp);
      case 'payments':
        return this.exportPayments(dto, timestamp);
      case 'returns':
        return this.exportReturns(dto, timestamp);
      case 'stock':
        return this.exportStock(dto, timestamp);
      case 'stock_movements':
        return this.exportStockMovements(dto, timestamp);
      default:
        throw new BadRequestException(`Unsupported dataset: ${dto.dataset}`);
    }
  }

  private async exportProducts(timestamp: string) {
    const products = await this.prisma.product.findMany({
      orderBy: { sku: 'asc' },
      include: {
        category: true,
        manufacturer: true,
        unit: true,
      },
    });

    const headers = [
      'SKU',
      'Name',
      'Generic Name',
      'Category',
      'Manufacturer',
      'Unit of Measurement',
      'Dosage Form',
      'Strength',
      'Pack Size',
      'Barcode',
      'Tax Percentage (%)',
      'Description',
      'Active Status',
      'Created At',
    ];

    const rows = products.map((p) => [
      p.sku,
      p.name,
      p.genericName || '',
      p.category?.name || '',
      p.manufacturer?.name || '',
      p.unit?.name || '',
      p.dosageForm || '',
      p.strength || '',
      p.packSize || '',
      p.barcode || '',
      p.taxPercentage ? p.taxPercentage.toString() : '0.00',
      p.description || '',
      p.isActive ? 'Active' : 'Inactive',
      p.createdAt.toISOString(),
    ]);

    return {
      filename: `medix_export_products_${timestamp}.csv`,
      data: this.generateCsv(headers, rows),
      rowCount: products.length,
    };
  }

  private async exportBatches(timestamp: string) {
    const batches = await this.prisma.batch.findMany({
      orderBy: { expiryDate: 'asc' },
      include: {
        product: true,
      },
    });

    const headers = [
      'Batch Number',
      'Product SKU',
      'Product Name',
      'Manufacturing Date',
      'Expiry Date',
      'Retail Price / MRP (Rs)',
      'Trade Price / TP (Rs)',
      'Purchase Cost (Rs)',
      'Status',
    ];

    const rows = batches.map((b) => [
      b.batchNumber,
      b.product.sku,
      b.product.name,
      b.mfgDate ? b.mfgDate.toISOString().slice(0, 10) : '',
      b.expiryDate.toISOString().slice(0, 10),
      b.retailPrice.toString(),
      b.tradePrice.toString(),
      b.purchaseCost.toString(),
      b.status,
    ]);

    return {
      filename: `medix_export_batches_${timestamp}.csv`,
      data: this.generateCsv(headers, rows),
      rowCount: batches.length,
    };
  }

  private async exportCustomers(timestamp: string) {
    const customers = await this.prisma.customer.findMany({
      orderBy: { name: 'asc' },
    });

    const headers = [
      'Customer Code',
      'Name',
      'Drug License Number',
      'Tax Number / NTN',
      'Phone',
      'Email',
      'Address',
      'City',
      'Credit Limit (Rs)',
      'Credit Days',
      'Outstanding Balance (Rs)',
      'Active Status',
      'Created At',
    ];

    const rows = customers.map((c) => [
      c.code,
      c.name,
      c.drugSaleLicenseNo || '',
      c.ntn || '',
      c.phone || '',
      c.email || '',
      c.address || '',
      c.city || '',
      c.creditLimit.toString(),
      c.creditDays,
      c.currentBalance.toString(),
      c.isActive ? 'Active' : 'Inactive',
      c.createdAt.toISOString(),
    ]);

    return {
      filename: `medix_export_customers_${timestamp}.csv`,
      data: this.generateCsv(headers, rows),
      rowCount: customers.length,
    };
  }

  private async exportSuppliers(timestamp: string) {
    const suppliers = await this.prisma.supplier.findMany({
      orderBy: { name: 'asc' },
    });

    const headers = [
      'Supplier Code',
      'Name',
      'Drug License Number',
      'Tax Number / NTN',
      'Phone',
      'Email',
      'Address',
      'City',
      'Outstanding Balance (Rs)',
      'Active Status',
      'Created At',
    ];

    const rows = suppliers.map((s) => [
      s.code,
      s.name,
      s.drugLicenseNo || '',
      s.ntn || '',
      s.phone || '',
      s.email || '',
      s.address || '',
      s.city || '',
      s.currentBalance.toString(),
      s.isActive ? 'Active' : 'Inactive',
      s.createdAt.toISOString(),
    ]);

    return {
      filename: `medix_export_suppliers_${timestamp}.csv`,
      data: this.generateCsv(headers, rows),
      rowCount: suppliers.length,
    };
  }

  private async exportSalesInvoices(dto: ExportDatasetDto, timestamp: string) {
    const where: any = {};
    if (dto.startDate || dto.endDate) {
      where.invoiceDate = {};
      if (dto.startDate) where.invoiceDate.gte = new Date(dto.startDate);
      if (dto.endDate) where.invoiceDate.lte = new Date(dto.endDate);
    }
    if (dto.branchId) where.branchId = dto.branchId;

    const invoices = await this.prisma.salesInvoice.findMany({
      where,
      orderBy: { invoiceDate: 'desc' },
      include: {
        customer: true,
        branch: true,
      },
    });

    const headers = [
      'Invoice Number',
      'Date',
      'Customer Code',
      'Customer Name',
      'Branch',
      'Subtotal (Rs)',
      'Discount Amount (Rs)',
      'Tax Amount (Rs)',
      'Net Total (Rs)',
      'Paid Amount (Rs)',
      'Balance Amount (Rs)',
      'Status',
      'Payment Method',
    ];

    const rows = invoices.map((inv) => [
      inv.invoiceNumber || inv.draftNumber || '',
      inv.invoiceDate.toISOString().slice(0, 10),
      inv.customer.code,
      inv.customer.name,
      inv.branch.name,
      inv.subtotal.toString(),
      inv.discountAmount.toString(),
      inv.taxAmount.toString(),
      inv.netTotal.toString(),
      inv.paidAmount.toString(),
      inv.balanceAmount.toString(),
      inv.status,
      inv.paymentMethod,
    ]);

    return {
      filename: `medix_export_sales_invoices_${timestamp}.csv`,
      data: this.generateCsv(headers, rows),
      rowCount: invoices.length,
    };
  }

  private async exportPurchases(dto: ExportDatasetDto, timestamp: string) {
    const where: any = {};
    if (dto.startDate || dto.endDate) {
      where.receivedDate = {};
      if (dto.startDate) where.receivedDate.gte = new Date(dto.startDate);
      if (dto.endDate) where.receivedDate.lte = new Date(dto.endDate);
    }
    if (dto.branchId) where.branchId = dto.branchId;

    const grns = await this.prisma.goodsReceiveNote.findMany({
      where,
      orderBy: { receivedDate: 'desc' },
      include: {
        supplier: true,
        branch: true,
      },
    });

    const headers = [
      'GRN Number',
      'Received Date',
      'Supplier Code',
      'Supplier Name',
      'Supplier Invoice #',
      'Branch',
      'Subtotal (Rs)',
      'Tax Amount (Rs)',
      'Discount Amount (Rs)',
      'Net Total (Rs)',
      'Paid Amount (Rs)',
      'Balance Amount (Rs)',
      'Status',
    ];

    const rows = grns.map((g) => [
      g.grnNumber,
      g.receivedDate.toISOString().slice(0, 10),
      g.supplier.code,
      g.supplier.name,
      g.supplierInvoiceNumber || '',
      g.branch.name,
      g.subtotal.toString(),
      g.taxAmount.toString(),
      g.discountAmount.toString(),
      g.netTotal.toString(),
      g.paidAmount.toString(),
      g.balanceAmount.toString(),
      g.status,
    ]);

    return {
      filename: `medix_export_purchases_${timestamp}.csv`,
      data: this.generateCsv(headers, rows),
      rowCount: grns.length,
    };
  }

  private async exportPayments(dto: ExportDatasetDto, timestamp: string) {
    const customerPayments = await this.prisma.customerPayment.findMany({
      orderBy: { paymentDate: 'desc' },
      include: { customer: true, branch: true },
    });

    const supplierPayments = await this.prisma.supplierPayment.findMany({
      orderBy: { paymentDate: 'desc' },
      include: { supplier: true, branch: true },
    });

    const headers = [
      'Payment Number',
      'Date',
      'Party Type',
      'Party Name',
      'Branch',
      'Amount (Rs)',
      'Payment Method',
      'Reference / Instrument #',
      'Status',
    ];

    const rows = [
      ...customerPayments.map((p) => [
        p.paymentNumber,
        p.paymentDate.toISOString().slice(0, 10),
        'Customer',
        p.customer.name,
        p.branch.name,
        p.amount.toString(),
        p.paymentMethod,
        p.referenceNumber || '',
        p.status,
      ]),
      ...supplierPayments.map((p) => [
        p.paymentNumber,
        p.paymentDate.toISOString().slice(0, 10),
        'Supplier',
        p.supplier.name,
        p.branch.name,
        p.amount.toString(),
        p.paymentMethod,
        p.referenceNumber || '',
        p.status,
      ]),
    ];

    return {
      filename: `medix_export_payments_${timestamp}.csv`,
      data: this.generateCsv(headers, rows),
      rowCount: rows.length,
    };
  }

  private async exportReturns(dto: ExportDatasetDto, timestamp: string) {
    const salesReturns = await this.prisma.salesReturn.findMany({
      orderBy: { returnDate: 'desc' },
      include: { customer: true, branch: true },
    });

    const purchaseReturns = await this.prisma.purchaseReturn.findMany({
      orderBy: { returnDate: 'desc' },
      include: { supplier: true, branch: true },
    });

    const headers = [
      'Return Number',
      'Return Date',
      'Type',
      'Party Name',
      'Branch',
      'Net Total (Rs)',
      'Reason',
      'Status',
    ];

    const rows = [
      ...salesReturns.map((r) => [
        r.returnNumber,
        r.returnDate.toISOString().slice(0, 10),
        'Customer Return',
        r.customer.name,
        r.branch.name,
        r.netTotal.toString(),
        r.reason || '',
        r.status,
      ]),
      ...purchaseReturns.map((r) => [
        r.returnNumber,
        r.returnDate.toISOString().slice(0, 10),
        'Supplier Return',
        r.supplier.name,
        r.branch.name,
        r.netTotal.toString(),
        r.reason || '',
        r.status,
      ]),
    ];

    return {
      filename: `medix_export_returns_${timestamp}.csv`,
      data: this.generateCsv(headers, rows),
      rowCount: rows.length,
    };
  }

  private async exportStock(dto: ExportDatasetDto, timestamp: string) {
    const where: any = {};
    if (dto.warehouseId) where.warehouseId = dto.warehouseId;

    const grouped = await this.prisma.stockMovement.groupBy({
      by: ['warehouseId', 'productId', 'batchId'],
      where,
      _sum: { quantity: true },
      having: {
        quantity: {
          _sum: {
            gt: 0,
          },
        },
      },
    });

    const warehouseIds = [...new Set(grouped.map((g) => g.warehouseId))];
    const productIds = [...new Set(grouped.map((g) => g.productId))];
    const batchIds = [...new Set(grouped.map((g) => g.batchId))];

    const [warehouses, products, batches] = await Promise.all([
      this.prisma.warehouse.findMany({ where: { id: { in: warehouseIds } } }),
      this.prisma.product.findMany({ where: { id: { in: productIds } } }),
      this.prisma.batch.findMany({ where: { id: { in: batchIds } } }),
    ]);

    const whMap = new Map(warehouses.map((w) => [w.id, w]));
    const prMap = new Map(products.map((p) => [p.id, p]));
    const btMap = new Map(batches.map((b) => [b.id, b]));

    const headers = [
      'Warehouse Code',
      'Warehouse Name',
      'Warehouse Type',
      'Product SKU',
      'Product Name',
      'Batch Number',
      'Expiry Date',
      'Quantity Available',
      'Retail Price / MRP (Rs)',
      'Valuation (Purchase Cost)',
    ];

    const rows = grouped.map((g) => {
      const wh = whMap.get(g.warehouseId);
      const pr = prMap.get(g.productId);
      const bt = btMap.get(g.batchId);
      const qty = g._sum.quantity || 0;
      const unitCost = bt ? Number(bt.purchaseCost) : 0;

      return [
        wh?.code || '',
        wh?.name || '',
        wh?.warehouseType || '',
        pr?.sku || '',
        pr?.name || '',
        bt?.batchNumber || '',
        bt ? bt.expiryDate.toISOString().slice(0, 10) : '',
        qty,
        bt?.retailPrice.toString() || '',
        (unitCost * qty).toFixed(2),
      ];
    });

    return {
      filename: `medix_export_stock_${timestamp}.csv`,
      data: this.generateCsv(headers, rows),
      rowCount: rows.length,
    };
  }

  private async exportStockMovements(dto: ExportDatasetDto, timestamp: string) {
    const where: any = {};
    if (dto.warehouseId) where.warehouseId = dto.warehouseId;
    if (dto.startDate || dto.endDate) {
      where.createdAt = {};
      if (dto.startDate) where.createdAt.gte = new Date(dto.startDate);
      if (dto.endDate) where.createdAt.lte = new Date(dto.endDate);
    }

    const movements = await this.prisma.stockMovement.findMany({
      where,
      take: 2000,
      orderBy: { createdAt: 'desc' },
      include: {
        warehouse: true,
        product: true,
        batch: true,
      },
    });

    const headers = [
      'Timestamp',
      'Movement Type',
      'Reference Type',
      'Reference ID',
      'Warehouse',
      'Product SKU',
      'Product Name',
      'Batch Number',
      'Quantity Change',
      'Unit Cost (Rs)',
      'Notes',
    ];

    const rows = movements.map((m) => [
      m.createdAt.toISOString(),
      m.movementType,
      m.referenceType,
      m.referenceId || '',
      m.warehouse.name,
      m.product.sku,
      m.product.name,
      m.batch.batchNumber,
      m.quantity,
      m.unitCost.toString(),
      m.notes || '',
    ]);

    return {
      filename: `medix_export_stock_movements_${timestamp}.csv`,
      data: this.generateCsv(headers, rows),
      rowCount: movements.length,
    };
  }
}
