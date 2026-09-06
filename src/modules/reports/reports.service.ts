import {
  Injectable,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  QueryReportDto,
  QueryCustomerStatementDto,
  QuerySupplierStatementDto,
  ReportExportFormat,
} from './dto/query-reports.dto';
import {
  SalesInvoiceStatus,
  GrnStatus,
  CustomerPaymentStatus,
  SalesReturnStatus,
  StockTransferStatus,
  Prisma,
} from '@prisma/client';

@Injectable()
export class ReportsService {
  private readonly logger = new Logger(ReportsService.name);

  constructor(private readonly prisma: PrismaService) {}

  private async getOrganizationId(): Promise<string> {
    const org = await this.prisma.organization.findFirst({
      select: { id: true },
    });
    if (!org) {
      throw new NotFoundException('Organization not found in system');
    }
    return org.id;
  }

  /**
   * Helper to format tabular records into CSV string with proper escaping.
   */
  exportToCsv(headers: { key: string; label: string }[], rows: any[]): string {
    const headerRow = headers.map((h) => `"${h.label.replace(/"/g, '""')}"`).join(',');
    const dataRows = rows.map((row) =>
      headers
        .map((h) => {
          let val = row[h.key];
          if (val === null || val === undefined) {
            val = '';
          } else if (val instanceof Date) {
            val = val.toISOString().split('T')[0];
          } else if (typeof val === 'object') {
            val = JSON.stringify(val);
          } else {
            val = String(val);
          }
          return `"${val.replace(/"/g, '""')}"`;
        })
        .join(','),
    );
    return [headerRow, ...dataRows].join('\r\n');
  }

  private getDateRangeFilter(startDate?: string, endDate?: string) {
    if (!startDate && !endDate) return undefined;
    const dateFilter: { gte?: Date; lte?: Date } = {};
    if (startDate) {
      const start = new Date(startDate);
      start.setHours(0, 0, 0, 0);
      dateFilter.gte = start;
    }
    if (endDate) {
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      dateFilter.lte = end;
    }
    return dateFilter;
  }

  // ==========================================
  // 1. SALES REPORTS
  // ==========================================

  /**
   * High-level sales performance summary (Gross, Net, Tax, Discounts, COGS, Gross Profit, Margin %).
   */
  async getSalesSummary(query: QueryReportDto) {
    const orgId = await this.getOrganizationId();
    const dateFilter = this.getDateRangeFilter(query.startDate, query.endDate);

    const invoices = await this.prisma.salesInvoice.findMany({
      where: {
        organizationId: orgId,
        status: SalesInvoiceStatus.POSTED,
        ...(query.branchId ? { branchId: query.branchId } : {}),
        ...(query.warehouseId ? { warehouseId: query.warehouseId } : {}),
        ...(query.customerId ? { customerId: query.customerId } : {}),
        ...(dateFilter ? { invoiceDate: dateFilter } : {}),
      },
      include: {
        items: true,
      },
    });

    let grossSales = 0;
    let discountAmount = 0;
    let taxAmount = 0;
    let netSales = 0;
    let paidAmount = 0;
    let outstandingAmount = 0;
    let totalCogs = 0;
    let totalQuantity = 0;

    for (const inv of invoices) {
      grossSales += Number(inv.subtotal);
      discountAmount += Number(inv.discountAmount);
      taxAmount += Number(inv.taxAmount);
      netSales += Number(inv.netTotal);
      paidAmount += Number(inv.paidAmount);
      outstandingAmount += Number(inv.balanceAmount);

      for (const item of inv.items) {
        totalCogs += Number(item.lineCost);
        totalQuantity += item.billedQuantity + item.bonusQuantity;
      }
    }

    const grossProfit = netSales - totalCogs;
    const marginPercentage = netSales > 0 ? (grossProfit / netSales) * 100 : 0;

    return {
      invoiceCount: invoices.length,
      totalQuantity,
      grossSales: Number(grossSales.toFixed(2)),
      discountAmount: Number(discountAmount.toFixed(2)),
      taxAmount: Number(taxAmount.toFixed(2)),
      netSales: Number(netSales.toFixed(2)),
      paidAmount: Number(paidAmount.toFixed(2)),
      outstandingAmount: Number(outstandingAmount.toFixed(2)),
      totalCogs: Number(totalCogs.toFixed(2)),
      grossProfit: Number(grossProfit.toFixed(2)),
      marginPercentage: Number(marginPercentage.toFixed(2)),
    };
  }

  /**
   * Detailed sales register with line items and customer breakdown.
   */
  async getSalesRegister(query: QueryReportDto) {
    const orgId = await this.getOrganizationId();
    const dateFilter = this.getDateRangeFilter(query.startDate, query.endDate);

    const where: Prisma.SalesInvoiceWhereInput = {
      organizationId: orgId,
      status: SalesInvoiceStatus.POSTED,
      ...(query.branchId ? { branchId: query.branchId } : {}),
      ...(query.warehouseId ? { warehouseId: query.warehouseId } : {}),
      ...(query.customerId ? { customerId: query.customerId } : {}),
      ...(dateFilter ? { invoiceDate: dateFilter } : {}),
    };

    if (query.search) {
      where.OR = [
        { invoiceNumber: { contains: query.search, mode: 'insensitive' } },
        { customer: { name: { contains: query.search, mode: 'insensitive' } } },
        { customer: { code: { contains: query.search, mode: 'insensitive' } } },
      ];
    }

    const invoices = await this.prisma.salesInvoice.findMany({
      where,
      include: {
        customer: true,
        warehouse: true,
        branch: true,
        items: {
          include: {
            product: true,
            batch: true,
          },
        },
      },
      orderBy: [{ invoiceDate: 'desc' }, { invoiceNumber: 'desc' }],
    });

    const rows = invoices.map((inv) => {
      const net = Number(inv.netTotal);
      const cogs = inv.items.reduce((sum, it) => sum + Number(it.lineCost), 0);
      const profit = net - cogs;
      const margin = net > 0 ? (profit / net) * 100 : 0;
      const units = inv.items.reduce((sum, it) => sum + it.billedQuantity + it.bonusQuantity, 0);
      const balanceDue = Number(inv.balanceAmount);
      const paidAmount = Number(inv.paidAmount);
      const paymentStatus = balanceDue <= 0 ? 'PAID' : (paidAmount > 0 ? 'PARTIALLY_PAID' : 'UNPAID');

      return {
        id: inv.id,
        invoiceNumber: inv.invoiceNumber,
        invoiceDate: inv.invoiceDate,
        customerCode: inv.customer.code,
        customerName: inv.customer.name,
        warehouseName: inv.warehouse.name,
        subtotal: Number(inv.subtotal),
        discountAmount: Number(inv.discountAmount),
        taxAmount: Number(inv.taxAmount),
        netTotal: net,
        paidAmount,
        balanceDue,
        paymentStatus,
        itemCount: inv.items.length,
        totalUnits: units,
        totalCogs: Number(cogs.toFixed(2)),
        grossProfit: Number(profit.toFixed(2)),
        marginPercentage: Number(margin.toFixed(2)),
      };
    });

    if (query.format === ReportExportFormat.CSV) {
      const headers = [
        { key: 'invoiceNumber', label: 'Invoice Number' },
        { key: 'invoiceDate', label: 'Date' },
        { key: 'customerCode', label: 'Customer Code' },
        { key: 'customerName', label: 'Customer Name' },
        { key: 'warehouseName', label: 'Warehouse' },
        { key: 'subtotal', label: 'Gross Sales' },
        { key: 'discountAmount', label: 'Discount' },
        { key: 'taxAmount', label: 'Tax' },
        { key: 'netTotal', label: 'Net Sales' },
        { key: 'paidAmount', label: 'Paid' },
        { key: 'balanceDue', label: 'Outstanding' },
        { key: 'paymentStatus', label: 'Payment Status' },
        { key: 'totalUnits', label: 'Total Units' },
        { key: 'totalCogs', label: 'COGS' },
        { key: 'grossProfit', label: 'Gross Profit' },
        { key: 'marginPercentage', label: 'Margin %' },
      ];
      return { csv: this.exportToCsv(headers, rows) };
    }

    return { data: rows, totalCount: rows.length };
  }

  /**
   * Product-wise sales breakdown with quantities, revenue, historical cost, and profit margins.
   */
  async getProductWiseSales(query: QueryReportDto) {
    const orgId = await this.getOrganizationId();
    const dateFilter = this.getDateRangeFilter(query.startDate, query.endDate);

    const items = await this.prisma.salesInvoiceItem.findMany({
      where: {
        salesInvoice: {
          organizationId: orgId,
          status: SalesInvoiceStatus.POSTED,
          ...(query.branchId ? { branchId: query.branchId } : {}),
          ...(query.warehouseId ? { warehouseId: query.warehouseId } : {}),
          ...(query.customerId ? { customerId: query.customerId } : {}),
          ...(dateFilter ? { invoiceDate: dateFilter } : {}),
        },
        ...(query.productId ? { productId: query.productId } : {}),
        ...(query.manufacturerId
          ? { product: { manufacturerId: query.manufacturerId } }
          : {}),
      },
      include: {
        product: {
          include: { manufacturer: true, unit: true },
        },
        batch: true,
      },
    });

    const productMap = new Map<
      string,
      {
        productId: string;
        sku: string;
        name: string;
        genericName: string;
        manufacturerName: string | null;
        unitSymbol: string | null;
        billedQuantity: number;
        bonusQuantity: number;
        totalQuantity: number;
        grossAmount: number;
        discountAmount: number;
        taxAmount: number;
        netSales: number;
        historicalCost: number;
        grossProfit: number;
        marginPercentage: number;
      }
    >();

    for (const it of items) {
      const pId = it.productId;
      const current = productMap.get(pId) || {
        productId: pId,
        sku: it.product.sku,
        name: it.product.name,
        genericName: it.product.genericName,
        manufacturerName: it.product.manufacturer?.name || null,
        unitSymbol: it.product.unit?.symbol || null,
        billedQuantity: 0,
        bonusQuantity: 0,
        totalQuantity: 0,
        grossAmount: 0,
        discountAmount: 0,
        taxAmount: 0,
        netSales: 0,
        historicalCost: 0,
        grossProfit: 0,
        marginPercentage: 0,
      };

      current.billedQuantity += it.billedQuantity;
      current.bonusQuantity += it.bonusQuantity;
      current.totalQuantity += it.totalQuantity;
      current.grossAmount += it.billedQuantity * Number(it.unitPrice);
      current.discountAmount += Number(it.discountAmount);
      current.taxAmount += Number(it.taxAmount);
      current.netSales += Number(it.lineTotal);
      current.historicalCost += Number(it.lineCost);

      productMap.set(pId, current);
    }

    const rows = Array.from(productMap.values()).map((p) => {
      const grossProfit = p.netSales - p.historicalCost;
      const marginPercentage = p.netSales > 0 ? (grossProfit / p.netSales) * 100 : 0;
      return {
        ...p,
        grossAmount: Number(p.grossAmount.toFixed(2)),
        discountAmount: Number(p.discountAmount.toFixed(2)),
        taxAmount: Number(p.taxAmount.toFixed(2)),
        netSales: Number(p.netSales.toFixed(2)),
        historicalCost: Number(p.historicalCost.toFixed(2)),
        grossProfit: Number(grossProfit.toFixed(2)),
        marginPercentage: Number(marginPercentage.toFixed(2)),
      };
    });

    if (query.format === ReportExportFormat.CSV) {
      const headers = [
        { key: 'sku', label: 'SKU' },
        { key: 'name', label: 'Product Name' },
        { key: 'genericName', label: 'Generic Name' },
        { key: 'manufacturerName', label: 'Manufacturer' },
        { key: 'billedQuantity', label: 'Billed Qty' },
        { key: 'bonusQuantity', label: 'Bonus Qty' },
        { key: 'totalQuantity', label: 'Total Units' },
        { key: 'netSales', label: 'Net Sales' },
        { key: 'historicalCost', label: 'COGS' },
        { key: 'grossProfit', label: 'Gross Profit' },
        { key: 'marginPercentage', label: 'Margin %' },
      ];
      return { csv: this.exportToCsv(headers, rows) };
    }

    return { data: rows, totalCount: rows.length };
  }

  /**
   * Customer-wise sales breakdown with revenue, invoices count, and payment standing.
   */
  async getCustomerWiseSales(query: QueryReportDto) {
    const orgId = await this.getOrganizationId();
    const dateFilter = this.getDateRangeFilter(query.startDate, query.endDate);

    const invoices = await this.prisma.salesInvoice.findMany({
      where: {
        organizationId: orgId,
        status: SalesInvoiceStatus.POSTED,
        ...(query.branchId ? { branchId: query.branchId } : {}),
        ...(query.warehouseId ? { warehouseId: query.warehouseId } : {}),
        ...(query.customerId ? { customerId: query.customerId } : {}),
        ...(dateFilter ? { invoiceDate: dateFilter } : {}),
      },
      include: {
        customer: true,
        items: true,
      },
    });

    const customerMap = new Map<
      string,
      {
        customerId: string;
        customerCode: string;
        customerName: string;
        customerType: string;
        invoiceCount: number;
        grossSales: number;
        discountAmount: number;
        taxAmount: number;
        netSales: number;
        paidAmount: number;
        outstandingAmount: number;
        historicalCost: number;
        grossProfit: number;
        marginPercentage: number;
      }
    >();

    for (const inv of invoices) {
      const cId = inv.customerId;
      const current = customerMap.get(cId) || {
        customerId: cId,
        customerCode: inv.customer.code,
        customerName: inv.customer.name,
        customerType: inv.customer.customerType,
        invoiceCount: 0,
        grossSales: 0,
        discountAmount: 0,
        taxAmount: 0,
        netSales: 0,
        paidAmount: 0,
        outstandingAmount: 0,
        historicalCost: 0,
        grossProfit: 0,
        marginPercentage: 0,
      };

      current.invoiceCount += 1;
      current.grossSales += Number(inv.subtotal);
      current.discountAmount += Number(inv.discountAmount);
      current.taxAmount += Number(inv.taxAmount);
      current.netSales += Number(inv.netTotal);
      current.paidAmount += Number(inv.paidAmount);
      current.outstandingAmount += Number(inv.balanceAmount);

      for (const it of inv.items) {
        current.historicalCost += Number(it.lineCost);
      }

      customerMap.set(cId, current);
    }

    const rows = Array.from(customerMap.values()).map((c) => {
      const grossProfit = c.netSales - c.historicalCost;
      const marginPercentage = c.netSales > 0 ? (grossProfit / c.netSales) * 100 : 0;
      return {
        ...c,
        grossSales: Number(c.grossSales.toFixed(2)),
        discountAmount: Number(c.discountAmount.toFixed(2)),
        taxAmount: Number(c.taxAmount.toFixed(2)),
        netSales: Number(c.netSales.toFixed(2)),
        paidAmount: Number(c.paidAmount.toFixed(2)),
        outstandingAmount: Number(c.outstandingAmount.toFixed(2)),
        historicalCost: Number(c.historicalCost.toFixed(2)),
        grossProfit: Number(grossProfit.toFixed(2)),
        marginPercentage: Number(marginPercentage.toFixed(2)),
      };
    });

    if (query.format === ReportExportFormat.CSV) {
      const headers = [
        { key: 'customerCode', label: 'Customer Code' },
        { key: 'customerName', label: 'Customer Name' },
        { key: 'customerType', label: 'Type' },
        { key: 'invoiceCount', label: 'Invoices' },
        { key: 'grossSales', label: 'Gross Sales' },
        { key: 'discountAmount', label: 'Discount' },
        { key: 'netSales', label: 'Net Sales' },
        { key: 'paidAmount', label: 'Paid' },
        { key: 'outstandingAmount', label: 'Outstanding' },
        { key: 'grossProfit', label: 'Gross Profit' },
        { key: 'marginPercentage', label: 'Margin %' },
      ];
      return { csv: this.exportToCsv(headers, rows) };
    }

    return { data: rows, totalCount: rows.length };
  }

  /**
   * Sales returns report.
   */
  async getSalesReturnsReport(query: QueryReportDto) {
    const orgId = await this.getOrganizationId();
    const dateFilter = this.getDateRangeFilter(query.startDate, query.endDate);

    const returns = await this.prisma.salesReturn.findMany({
      where: {
        organizationId: orgId,
        status: SalesReturnStatus.POSTED,
        ...(query.branchId ? { branchId: query.branchId } : {}),
        ...(query.customerId ? { customerId: query.customerId } : {}),
        ...(dateFilter ? { returnDate: dateFilter } : {}),
      },
      include: {
        customer: true,
        items: {
          include: {
            product: true,
            batch: true,
            destinationWarehouse: true,
          },
        },
      },
      orderBy: [{ returnDate: 'desc' }, { returnNumber: 'desc' }],
    });

    const rows = returns.map((r) => {
      let returnedQty = 0;
      for (const it of r.items) {
        returnedQty += it.returnedQuantity;
      }
      return {
        id: r.id,
        returnNumber: r.returnNumber,
        returnDate: r.returnDate,
        customerCode: r.customer.code,
        customerName: r.customer.name,
        reason: r.reason,
        refundMode: r.refundMode,
        refundAmount: Number(r.refundAmount),
        subtotal: Number(r.subtotal),
        discountAmount: Number(r.discountAmount),
        taxAmount: Number(r.taxAmount),
        netTotal: Number(r.netTotal),
        itemCount: r.items.length,
        totalQuantity: returnedQty,
      };
    });

    if (query.format === ReportExportFormat.CSV) {
      const headers = [
        { key: 'returnNumber', label: 'Return #' },
        { key: 'returnDate', label: 'Date' },
        { key: 'customerCode', label: 'Customer Code' },
        { key: 'customerName', label: 'Customer Name' },
        { key: 'reason', label: 'Reason' },
        { key: 'refundMode', label: 'Refund Mode' },
        { key: 'netTotal', label: 'Net Return Total' },
        { key: 'refundAmount', label: 'Refund Amount' },
        { key: 'totalQuantity', label: 'Total Units Returned' },
      ];
      return { csv: this.exportToCsv(headers, rows) };
    }

    return { data: rows, totalCount: rows.length };
  }

  /**
   * Collections & payment receipts report.
   */
  async getCollectionsReport(query: QueryReportDto) {
    const orgId = await this.getOrganizationId();
    const dateFilter = this.getDateRangeFilter(query.startDate, query.endDate);

    const payments = await this.prisma.customerPayment.findMany({
      where: {
        organizationId: orgId,
        status: CustomerPaymentStatus.POSTED,
        ...(query.branchId ? { branchId: query.branchId } : {}),
        ...(query.customerId ? { customerId: query.customerId } : {}),
        ...(dateFilter ? { paymentDate: dateFilter } : {}),
      },
      include: {
        customer: true,
      },
      orderBy: [{ paymentDate: 'desc' }, { paymentNumber: 'desc' }],
    });

    const rows = payments.map((p) => ({
      id: p.id,
      paymentNumber: p.paymentNumber,
      paymentDate: p.paymentDate,
      customerCode: p.customer.code,
      customerName: p.customer.name,
      paymentMethod: p.paymentMethod,
      amount: Number(p.amount),
      allocatedAmount: Number(p.allocatedAmount),
      unallocatedAmount: Number(p.unallocatedAmount),
      referenceNumber: p.referenceNumber || '',
      bankName: p.bankName || '',
    }));

    if (query.format === ReportExportFormat.CSV) {
      const headers = [
        { key: 'paymentNumber', label: 'Receipt #' },
        { key: 'paymentDate', label: 'Date' },
        { key: 'customerCode', label: 'Customer Code' },
        { key: 'customerName', label: 'Customer Name' },
        { key: 'paymentMethod', label: 'Method' },
        { key: 'amount', label: 'Total Collected' },
        { key: 'allocatedAmount', label: 'Allocated' },
        { key: 'unallocatedAmount', label: 'Advance / Unallocated' },
        { key: 'referenceNumber', label: 'Reference' },
      ];
      return { csv: this.exportToCsv(headers, rows) };
    }

    return { data: rows, totalCount: rows.length };
  }

  // ==========================================
  // 2. PURCHASE REPORTS
  // ==========================================

  /**
   * High-level purchase summary.
   */
  async getPurchaseSummary(query: QueryReportDto) {
    const orgId = await this.getOrganizationId();
    const dateFilter = this.getDateRangeFilter(query.startDate, query.endDate);

    const grns = await this.prisma.goodsReceiveNote.findMany({
      where: {
        organizationId: orgId,
        status: GrnStatus.POSTED,
        ...(query.branchId ? { branchId: query.branchId } : {}),
        ...(query.warehouseId ? { warehouseId: query.warehouseId } : {}),
        ...(query.supplierId ? { supplierId: query.supplierId } : {}),
        ...(dateFilter ? { receivedDate: dateFilter } : {}),
      },
      include: {
        items: true,
      },
    });

    let grossPurchases = 0;
    let discountAmount = 0;
    let taxAmount = 0;
    let netPurchases = 0;
    let paidAmount = 0;
    let outstandingAmount = 0;
    let totalBilledQuantity = 0;
    let totalBonusQuantity = 0;

    for (const g of grns) {
      grossPurchases += Number(g.subtotal);
      discountAmount += Number(g.discountAmount);
      taxAmount += Number(g.taxAmount);
      netPurchases += Number(g.netTotal);
      paidAmount += Number(g.paidAmount);
      outstandingAmount += Number(g.balanceAmount);

      for (const item of g.items) {
        totalBilledQuantity += item.receivedQuantity;
        totalBonusQuantity += item.bonusQuantity;
      }
    }

    return {
      grnCount: grns.length,
      totalBilledQuantity,
      totalBonusQuantity,
      totalUnits: totalBilledQuantity + totalBonusQuantity,
      grossPurchases: Number(grossPurchases.toFixed(2)),
      discountAmount: Number(discountAmount.toFixed(2)),
      taxAmount: Number(taxAmount.toFixed(2)),
      netPurchases: Number(netPurchases.toFixed(2)),
      paidAmount: Number(paidAmount.toFixed(2)),
      outstandingAmount: Number(outstandingAmount.toFixed(2)),
    };
  }

  /**
   * Detailed purchase / GRN register.
   */
  async getPurchaseRegister(query: QueryReportDto) {
    const orgId = await this.getOrganizationId();
    const dateFilter = this.getDateRangeFilter(query.startDate, query.endDate);

    const where: Prisma.GoodsReceiveNoteWhereInput = {
      organizationId: orgId,
      status: GrnStatus.POSTED,
      ...(query.branchId ? { branchId: query.branchId } : {}),
      ...(query.warehouseId ? { warehouseId: query.warehouseId } : {}),
      ...(query.supplierId ? { supplierId: query.supplierId } : {}),
      ...(dateFilter ? { receivedDate: dateFilter } : {}),
    };

    if (query.search) {
      where.OR = [
        { grnNumber: { contains: query.search, mode: 'insensitive' } },
        { supplierInvoiceNumber: { contains: query.search, mode: 'insensitive' } },
        { supplier: { name: { contains: query.search, mode: 'insensitive' } } },
      ];
    }

    const grns = await this.prisma.goodsReceiveNote.findMany({
      where,
      include: {
        supplier: true,
        warehouse: true,
        items: true,
      },
      orderBy: [{ receivedDate: 'desc' }, { grnNumber: 'desc' }],
    });

    const rows = grns.map((g) => {
      let billedQty = 0;
      let bonusQty = 0;
      for (const it of g.items) {
        billedQty += it.receivedQuantity;
        bonusQty += it.bonusQuantity;
      }
      const net = Number(g.netTotal);
      const paid = Number(g.paidAmount);
      const balanceDue = Number(g.balanceAmount);
      const paymentStatus = balanceDue <= 0 ? 'PAID' : (paid > 0 ? 'PARTIALLY_PAID' : 'UNPAID');

      return {
        id: g.id,
        grnNumber: g.grnNumber,
        supplierInvoiceNumber: g.supplierInvoiceNumber || '',
        receivedDate: g.receivedDate,
        supplierCode: g.supplier.code,
        supplierName: g.supplier.name,
        warehouseName: g.warehouse.name,
        subtotal: Number(g.subtotal),
        discountAmount: Number(g.discountAmount),
        taxAmount: Number(g.taxAmount),
        netTotal: net,
        paidAmount: paid,
        balanceDue,
        paymentStatus,
        billedQuantity: billedQty,
        bonusQuantity: bonusQty,
        totalUnits: billedQty + bonusQty,
        itemCount: g.items.length,
      };
    });

    if (query.format === ReportExportFormat.CSV) {
      const headers = [
        { key: 'grnNumber', label: 'GRN Number' },
        { key: 'supplierInvoiceNumber', label: 'Supplier Inv #' },
        { key: 'receivedDate', label: 'Received Date' },
        { key: 'supplierCode', label: 'Supplier Code' },
        { key: 'supplierName', label: 'Supplier Name' },
        { key: 'warehouseName', label: 'Warehouse' },
        { key: 'subtotal', label: 'Gross Purchase' },
        { key: 'discountAmount', label: 'Discount' },
        { key: 'taxAmount', label: 'Tax' },
        { key: 'netTotal', label: 'Net Purchase' },
        { key: 'paidAmount', label: 'Paid' },
        { key: 'balanceDue', label: 'Payable Balance' },
        { key: 'paymentStatus', label: 'Status' },
        { key: 'totalUnits', label: 'Total Units' },
      ];
      return { csv: this.exportToCsv(headers, rows) };
    }

    return { data: rows, totalCount: rows.length };
  }

  /**
   * Supplier-wise purchase breakdown.
   */
  async getSupplierWisePurchases(query: QueryReportDto) {
    const orgId = await this.getOrganizationId();
    const dateFilter = this.getDateRangeFilter(query.startDate, query.endDate);

    const grns = await this.prisma.goodsReceiveNote.findMany({
      where: {
        organizationId: orgId,
        status: GrnStatus.POSTED,
        ...(query.branchId ? { branchId: query.branchId } : {}),
        ...(query.supplierId ? { supplierId: query.supplierId } : {}),
        ...(dateFilter ? { receivedDate: dateFilter } : {}),
      },
      include: {
        supplier: true,
        items: true,
      },
    });

    const supplierMap = new Map<
      string,
      {
        supplierId: string;
        supplierCode: string;
        supplierName: string;
        grnCount: number;
        billedQuantity: number;
        bonusQuantity: number;
        totalUnits: number;
        grossPurchases: number;
        discountAmount: number;
        taxAmount: number;
        netPurchases: number;
        paidAmount: number;
        outstandingAmount: number;
      }
    >();

    for (const g of grns) {
      const sId = g.supplierId;
      const current = supplierMap.get(sId) || {
        supplierId: sId,
        supplierCode: g.supplier.code,
        supplierName: g.supplier.name,
        grnCount: 0,
        billedQuantity: 0,
        bonusQuantity: 0,
        totalUnits: 0,
        grossPurchases: 0,
        discountAmount: 0,
        taxAmount: 0,
        netPurchases: 0,
        paidAmount: 0,
        outstandingAmount: 0,
      };

      current.grnCount += 1;
      current.grossPurchases += Number(g.subtotal);
      current.discountAmount += Number(g.discountAmount);
      current.taxAmount += Number(g.taxAmount);
      current.netPurchases += Number(g.netTotal);
      current.paidAmount += Number(g.paidAmount);
      current.outstandingAmount += Number(g.balanceAmount);

      for (const it of g.items) {
        current.billedQuantity += it.receivedQuantity;
        current.bonusQuantity += it.bonusQuantity;
        current.totalUnits += it.receivedQuantity + it.bonusQuantity;
      }

      supplierMap.set(sId, current);
    }

    const rows = Array.from(supplierMap.values()).map((s) => ({
      ...s,
      grossPurchases: Number(s.grossPurchases.toFixed(2)),
      discountAmount: Number(s.discountAmount.toFixed(2)),
      taxAmount: Number(s.taxAmount.toFixed(2)),
      netPurchases: Number(s.netPurchases.toFixed(2)),
      paidAmount: Number(s.paidAmount.toFixed(2)),
      outstandingAmount: Number(s.outstandingAmount.toFixed(2)),
    }));

    if (query.format === ReportExportFormat.CSV) {
      const headers = [
        { key: 'supplierCode', label: 'Supplier Code' },
        { key: 'supplierName', label: 'Supplier Name' },
        { key: 'grnCount', label: 'GRNs' },
        { key: 'totalUnits', label: 'Total Units' },
        { key: 'grossPurchases', label: 'Gross' },
        { key: 'discountAmount', label: 'Discount' },
        { key: 'netPurchases', label: 'Net Purchases' },
        { key: 'paidAmount', label: 'Paid' },
        { key: 'outstandingAmount', label: 'Outstanding Payable' },
      ];
      return { csv: this.exportToCsv(headers, rows) };
    }

    return { data: rows, totalCount: rows.length };
  }

  // ==========================================
  // 3. INVENTORY & STOCK VALUATION REPORTS
  // ==========================================

  /**
   * Current stock on hand and valuation derived strictly from StockMovement ledger.
   */
  async getStockValuationReport(query: QueryReportDto) {
    const orgId = await this.getOrganizationId();
    const now = new Date();

    const batches = await this.prisma.batch.findMany({
      where: {
        product: {
          organizationId: orgId,
          ...(query.productId ? { id: query.productId } : {}),
          ...(query.manufacturerId ? { manufacturerId: query.manufacturerId } : {}),
        },
        ...(query.batchId ? { id: query.batchId } : {}),
      },
      include: {
        product: {
          include: { manufacturer: true, unit: true },
        },
        stockMovements: {
          where: {
            organizationId: orgId,
            ...(query.branchId ? { branchId: query.branchId } : {}),
            ...(query.warehouseId ? { warehouseId: query.warehouseId } : {}),
          },
          include: {
            warehouse: true,
          },
        },
      },
    });

    const rows: any[] = [];
    let grandTotalQty = 0;
    let grandStandardQty = 0;
    let grandQuarantineQty = 0;
    let grandPurchaseValuation = 0;
    let grandRetailValuation = 0;

    for (const b of batches) {
      let totalQty = 0;
      let standardQty = 0;
      let quarantineQty = 0;

      for (const m of b.stockMovements) {
        totalQty += m.quantity;
        if (m.warehouse.warehouseType === 'STANDARD') {
          standardQty += m.quantity;
        } else if (m.warehouse.warehouseType === 'QUARANTINE') {
          quarantineQty += m.quantity;
        }
      }

      if (totalQty <= 0) continue;

      const unitCost = Number(b.purchaseCost);
      const retailPrice = Number(b.retailPrice);
      const purchaseVal = totalQty * unitCost;
      const retailVal = totalQty * retailPrice;

      grandTotalQty += totalQty;
      grandStandardQty += Math.max(0, standardQty);
      grandQuarantineQty += Math.max(0, quarantineQty);
      grandPurchaseValuation += purchaseVal;
      grandRetailValuation += retailVal;

      const expiryDate = new Date(b.expiryDate);
      const isExpired = expiryDate <= now;
      const daysToExpiry = Math.ceil((expiryDate.getTime() - now.getTime()) / (86400000));

      rows.push({
        batchId: b.id,
        batchNumber: b.batchNumber,
        mfgDate: b.mfgDate,
        expiryDate: b.expiryDate,
        isExpired,
        daysToExpiry,
        status: b.status,
        productSku: b.product.sku,
        productName: b.product.name,
        genericName: b.product.genericName,
        manufacturerName: b.product.manufacturer?.name || null,
        unitSymbol: b.product.unit?.symbol || null,
        standardQuantity: Math.max(0, standardQty),
        quarantineQuantity: Math.max(0, quarantineQty),
        totalQuantity: totalQty,
        unitCost,
        retailPrice,
        purchaseValuation: Number(purchaseVal.toFixed(2)),
        retailValuation: Number(retailVal.toFixed(2)),
      });
    }

    if (query.format === ReportExportFormat.CSV) {
      const headers = [
        { key: 'productSku', label: 'SKU' },
        { key: 'productName', label: 'Product' },
        { key: 'manufacturerName', label: 'Manufacturer' },
        { key: 'batchNumber', label: 'Batch' },
        { key: 'expiryDate', label: 'Expiry' },
        { key: 'status', label: 'Status' },
        { key: 'standardQuantity', label: 'Standard Qty' },
        { key: 'quarantineQuantity', label: 'Quarantine Qty' },
        { key: 'totalQuantity', label: 'Total Units' },
        { key: 'unitCost', label: 'Unit Cost' },
        { key: 'purchaseValuation', label: 'Purchase Valuation' },
        { key: 'retailValuation', label: 'Retail Valuation' },
      ];
      return { csv: this.exportToCsv(headers, rows) };
    }

    return {
      summary: {
        batchCount: rows.length,
        totalQuantity: grandTotalQty,
        standardQuantity: grandStandardQty,
        quarantineQuantity: grandQuarantineQty,
        purchaseValuation: Number(grandPurchaseValuation.toFixed(2)),
        retailValuation: Number(grandRetailValuation.toFixed(2)),
      },
      data: rows,
    };
  }

  /**
   * Chronological Stock Movement Ledger.
   */
  async getStockLedgerReport(query: QueryReportDto) {
    const orgId = await this.getOrganizationId();
    const dateFilter = this.getDateRangeFilter(query.startDate, query.endDate);

    const movements = await this.prisma.stockMovement.findMany({
      where: {
        organizationId: orgId,
        ...(query.branchId ? { branchId: query.branchId } : {}),
        ...(query.warehouseId ? { warehouseId: query.warehouseId } : {}),
        ...(query.productId ? { productId: query.productId } : {}),
        ...(query.batchId ? { batchId: query.batchId } : {}),
        ...(dateFilter ? { movementDate: dateFilter } : {}),
      },
      include: {
        warehouse: true,
        product: true,
        batch: true,
        createdByUser: {
          select: { username: true, displayName: true },
        },
      },
      orderBy: [{ movementDate: 'asc' }, { createdAt: 'asc' }],
    });

    const rows = movements.map((m) => ({
      id: m.id,
      movementDate: m.movementDate,
      warehouseName: m.warehouse.name,
      warehouseType: m.warehouse.warehouseType,
      productSku: m.product.sku,
      productName: m.product.name,
      batchNumber: m.batch.batchNumber,
      expiryDate: m.batch.expiryDate,
      movementType: m.movementType,
      quantity: m.quantity,
      unitCost: Number(m.unitCost),
      referenceType: m.referenceType || '',
      referenceId: m.referenceId || '',
      notes: m.notes || '',
      performedBy: m.createdByUser?.displayName || 'System',
    }));

    if (query.format === ReportExportFormat.CSV) {
      const headers = [
        { key: 'movementDate', label: 'Date' },
        { key: 'warehouseName', label: 'Warehouse' },
        { key: 'productSku', label: 'SKU' },
        { key: 'productName', label: 'Product' },
        { key: 'batchNumber', label: 'Batch' },
        { key: 'movementType', label: 'Movement Type' },
        { key: 'quantity', label: 'Qty (+/-)' },
        { key: 'unitCost', label: 'Unit Cost' },
        { key: 'referenceType', label: 'Reference Type' },
        { key: 'notes', label: 'Notes' },
        { key: 'performedBy', label: 'User' },
      ];
      return { csv: this.exportToCsv(headers, rows) };
    }

    return { data: rows, totalCount: rows.length };
  }

  // ==========================================
  // 4. CUSTOMER AGING & STATEMENTS
  // ==========================================

  /**
   * Customer Accounts Receivable Aging Analysis.
   * Buckets: Current, 1–30d, 31–60d, 61–90d, 90+d.
   */
  async getCustomerAgingReport(query: QueryReportDto) {
    const orgId = await this.getOrganizationId();
    const now = new Date();

    const customers = await this.prisma.customer.findMany({
      where: {
        organizationId: orgId,
        ...(query.customerId ? { id: query.customerId } : {}),
      },
      include: {
        salesInvoices: {
          where: {
            organizationId: orgId,
            status: SalesInvoiceStatus.POSTED,
            balanceAmount: { gt: 0 },
            ...(query.branchId ? { branchId: query.branchId } : {}),
          },
        },
      },
      orderBy: [{ name: 'asc' }],
    });

    const rows: any[] = [];
    let grandTotalDue = 0;
    let grandCurrent = 0;
    let grand1to30 = 0;
    let grand31to60 = 0;
    let grand61to90 = 0;
    let grand90Plus = 0;

    for (const c of customers) {
      let current = 0;
      let days1to30 = 0;
      let days31to60 = 0;
      let days61to90 = 0;
      let days90Plus = 0;

      for (const inv of c.salesInvoices) {
        const balanceDue = Number(inv.balanceAmount);
        if (balanceDue <= 0) continue;

        const invDate = new Date(inv.invoiceDate);
        const ageDays = Math.floor((now.getTime() - invDate.getTime()) / (86400000));

        if (ageDays <= c.creditDays || ageDays <= 0) {
          current += balanceDue;
        } else {
          const overdueDays = ageDays - c.creditDays;
          if (overdueDays <= 30) {
            days1to30 += balanceDue;
          } else if (overdueDays <= 60) {
            days31to60 += balanceDue;
          } else if (overdueDays <= 90) {
            days61to90 += balanceDue;
          } else {
            days90Plus += balanceDue;
          }
        }
      }

      const totalReceivable = Number(c.currentBalance);
      if (totalReceivable <= 0 && c.salesInvoices.length === 0) {
        continue; // Skip accounts with zero balance and no open invoices
      }

      grandTotalDue += totalReceivable;
      grandCurrent += current;
      grand1to30 += days1to30;
      grand31to60 += days31to60;
      grand61to90 += days61to90;
      grand90Plus += days90Plus;

      rows.push({
        customerId: c.id,
        customerCode: c.code,
        customerName: c.name,
        customerType: c.customerType,
        creditDays: c.creditDays,
        creditLimit: Number(c.creditLimit),
        currentBalance: totalReceivable,
        current: Number(current.toFixed(2)),
        days1to30: Number(days1to30.toFixed(2)),
        days31to60: Number(days31to60.toFixed(2)),
        days61to90: Number(days61to90.toFixed(2)),
        days90Plus: Number(days90Plus.toFixed(2)),
      });
    }

    if (query.format === ReportExportFormat.CSV) {
      const headers = [
        { key: 'customerCode', label: 'Customer Code' },
        { key: 'customerName', label: 'Customer Name' },
        { key: 'customerType', label: 'Type' },
        { key: 'creditDays', label: 'Credit Days' },
        { key: 'currentBalance', label: 'Total Balance' },
        { key: 'current', label: 'Current / In-Term' },
        { key: 'days1to30', label: '1-30 Days Overdue' },
        { key: 'days31to60', label: '31-60 Days Overdue' },
        { key: 'days61to90', label: '61-90 Days Overdue' },
        { key: 'days90Plus', label: '90+ Days Overdue' },
      ];
      return { csv: this.exportToCsv(headers, rows) };
    }

    return {
      summary: {
        grandTotalDue: Number(grandTotalDue.toFixed(2)),
        grandCurrent: Number(grandCurrent.toFixed(2)),
        grand1to30: Number(grand1to30.toFixed(2)),
        grand31to60: Number(grand31to60.toFixed(2)),
        grand61to90: Number(grand61to90.toFixed(2)),
        grand90Plus: Number(grand90Plus.toFixed(2)),
      },
      data: rows,
    };
  }

  /**
   * Customer chronological ledger statement report.
   */
  async getCustomerStatement(customerId: string, query: QueryCustomerStatementDto) {
    const orgId = await this.getOrganizationId();

    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, organizationId: orgId },
    });

    if (!customer) {
      throw new NotFoundException(`Customer with ID "${customerId}" not found`);
    }

    const dateFilter = this.getDateRangeFilter(query.startDate, query.endDate);

    // Calculate opening balance before startDate
    let openingBalance = 0;
    if (query.startDate) {
      const start = new Date(query.startDate);
      start.setHours(0, 0, 0, 0);

      const priorEntries = await this.prisma.customerLedgerEntry.findMany({
        where: {
          organizationId: orgId,
          customerId,
          transactionDate: { lt: start },
        },
      });

      for (const e of priorEntries) {
        openingBalance += Number(e.debit) - Number(e.credit);
      }
    }

    // Fetch transactions in window
    const entries = await this.prisma.customerLedgerEntry.findMany({
      where: {
        organizationId: orgId,
        customerId,
        ...(dateFilter ? { transactionDate: dateFilter } : {}),
      },
      orderBy: [{ transactionDate: 'asc' }, { createdAt: 'asc' }],
    });

    let running = openingBalance;
    const rows = entries.map((e) => {
      const debit = Number(e.debit);
      const credit = Number(e.credit);
      running += debit - credit;

      return {
        id: e.id,
        transactionDate: e.transactionDate,
        entryType: e.entryType,
        referenceNumber: e.referenceNumber,
        notes: e.notes || '',
        debit,
        credit,
        runningBalance: Number(running.toFixed(2)),
      };
    });

    if (query.format === ReportExportFormat.CSV) {
      const headers = [
        { key: 'transactionDate', label: 'Date' },
        { key: 'entryType', label: 'Type' },
        { key: 'referenceNumber', label: 'Reference' },
        { key: 'notes', label: 'Notes' },
        { key: 'debit', label: 'Debit (Inv/Due)' },
        { key: 'credit', label: 'Credit (Paid/Ret)' },
        { key: 'runningBalance', label: 'Balance' },
      ];
      return { csv: this.exportToCsv(headers, rows) };
    }

    return {
      customer: {
        id: customer.id,
        code: customer.code,
        name: customer.name,
        currentBalance: Number(customer.currentBalance),
      },
      openingBalance: Number(openingBalance.toFixed(2)),
      closingBalance: Number(running.toFixed(2)),
      data: rows,
    };
  }

  // ==========================================
  // 5. SUPPLIER AGING & STATEMENTS
  // ==========================================

  /**
   * Supplier Accounts Payable Aging Analysis.
   */
  async getSupplierAgingReport(query: QueryReportDto) {
    const orgId = await this.getOrganizationId();
    const now = new Date();

    const suppliers = await this.prisma.supplier.findMany({
      where: {
        organizationId: orgId,
        ...(query.supplierId ? { id: query.supplierId } : {}),
      },
      include: {
        goodsReceiveNotes: {
          where: {
            organizationId: orgId,
            status: GrnStatus.POSTED,
            balanceAmount: { gt: 0 },
            ...(query.branchId ? { branchId: query.branchId } : {}),
          },
        },
      },
      orderBy: [{ name: 'asc' }],
    });

    const rows: any[] = [];
    let grandTotalPayable = 0;
    let grandCurrent = 0;
    let grand1to30 = 0;
    let grand31to60 = 0;
    let grand61to90 = 0;
    let grand90Plus = 0;

    for (const s of suppliers) {
      let current = 0;
      let days1to30 = 0;
      let days31to60 = 0;
      let days61to90 = 0;
      let days90Plus = 0;

      for (const grn of s.goodsReceiveNotes) {
        const balanceDue = Number(grn.balanceAmount);
        if (balanceDue <= 0) continue;

        const grnDate = new Date(grn.receivedDate);
        const ageDays = Math.floor((now.getTime() - grnDate.getTime()) / (86400000));

        if (ageDays <= s.creditDays || ageDays <= 0) {
          current += balanceDue;
        } else {
          const overdueDays = ageDays - s.creditDays;
          if (overdueDays <= 30) {
            days1to30 += balanceDue;
          } else if (overdueDays <= 60) {
            days31to60 += balanceDue;
          } else if (overdueDays <= 90) {
            days61to90 += balanceDue;
          } else {
            days90Plus += balanceDue;
          }
        }
      }

      const totalPayable = Number(s.currentBalance);
      if (totalPayable <= 0 && s.goodsReceiveNotes.length === 0) {
        continue;
      }

      grandTotalPayable += totalPayable;
      grandCurrent += current;
      grand1to30 += days1to30;
      grand31to60 += days31to60;
      grand61to90 += days61to90;
      grand90Plus += days90Plus;

      rows.push({
        supplierId: s.id,
        supplierCode: s.code,
        supplierName: s.name,
        creditDays: s.creditDays,
        creditLimit: Number(s.creditLimit),
        currentBalance: totalPayable,
        current: Number(current.toFixed(2)),
        days1to30: Number(days1to30.toFixed(2)),
        days31to60: Number(days31to60.toFixed(2)),
        days61to90: Number(days61to90.toFixed(2)),
        days90Plus: Number(days90Plus.toFixed(2)),
      });
    }

    if (query.format === ReportExportFormat.CSV) {
      const headers = [
        { key: 'supplierCode', label: 'Supplier Code' },
        { key: 'supplierName', label: 'Supplier Name' },
        { key: 'creditDays', label: 'Credit Days' },
        { key: 'currentBalance', label: 'Total Payable' },
        { key: 'current', label: 'Current' },
        { key: 'days1to30', label: '1-30 Days Overdue' },
        { key: 'days31to60', label: '31-60 Days Overdue' },
        { key: 'days61to90', label: '61-90 Days Overdue' },
        { key: 'days90Plus', label: '90+ Days Overdue' },
      ];
      return { csv: this.exportToCsv(headers, rows) };
    }

    return {
      summary: {
        grandTotalPayable: Number(grandTotalPayable.toFixed(2)),
        grandCurrent: Number(grandCurrent.toFixed(2)),
        grand1to30: Number(grand1to30.toFixed(2)),
        grand31to60: Number(grand31to60.toFixed(2)),
        grand61to90: Number(grand61to90.toFixed(2)),
        grand90Plus: Number(grand90Plus.toFixed(2)),
      },
      data: rows,
    };
  }

  /**
   * Supplier chronological ledger statement report.
   */
  async getSupplierStatement(supplierId: string, query: QuerySupplierStatementDto) {
    const orgId = await this.getOrganizationId();

    const supplier = await this.prisma.supplier.findFirst({
      where: { id: supplierId, organizationId: orgId },
    });

    if (!supplier) {
      throw new NotFoundException(`Supplier with ID "${supplierId}" not found`);
    }

    const dateFilter = this.getDateRangeFilter(query.startDate, query.endDate);

    // Calculate opening balance before startDate
    let openingBalance = 0;
    if (query.startDate) {
      const start = new Date(query.startDate);
      start.setHours(0, 0, 0, 0);

      const priorEntries = await this.prisma.supplierLedgerEntry.findMany({
        where: {
          organizationId: orgId,
          supplierId,
          transactionDate: { lt: start },
        },
      });

      for (const e of priorEntries) {
        openingBalance += Number(e.credit) - Number(e.debit);
      }
    }

    const entries = await this.prisma.supplierLedgerEntry.findMany({
      where: {
        organizationId: orgId,
        supplierId,
        ...(dateFilter ? { transactionDate: dateFilter } : {}),
      },
      orderBy: [{ transactionDate: 'asc' }, { createdAt: 'asc' }],
    });

    let running = openingBalance;
    const rows = entries.map((e) => {
      const credit = Number(e.credit);
      const debit = Number(e.debit);
      running += credit - debit;

      return {
        id: e.id,
        transactionDate: e.transactionDate,
        entryType: e.entryType,
        referenceNumber: e.referenceNumber,
        notes: e.notes || '',
        credit, // GRN payable additions
        debit, // Payments / Return deductions
        runningBalance: Number(running.toFixed(2)),
      };
    });

    if (query.format === ReportExportFormat.CSV) {
      const headers = [
        { key: 'transactionDate', label: 'Date' },
        { key: 'entryType', label: 'Type' },
        { key: 'referenceNumber', label: 'Reference' },
        { key: 'notes', label: 'Notes' },
        { key: 'credit', label: 'Credit (Purchase)' },
        { key: 'debit', label: 'Debit (Payment/Ret)' },
        { key: 'runningBalance', label: 'Payable Balance' },
      ];
      return { csv: this.exportToCsv(headers, rows) };
    }

    return {
      supplier: {
        id: supplier.id,
        code: supplier.code,
        name: supplier.name,
        currentBalance: Number(supplier.currentBalance),
      },
      openingBalance: Number(openingBalance.toFixed(2)),
      closingBalance: Number(running.toFixed(2)),
      data: rows,
    };
  }

  // ==========================================
  // 6. PROFITABILITY REPORTS
  // ==========================================

  /**
   * Profitability summary using historical COGS snapshots on posted invoice items.
   */
  async getProfitabilitySummary(query: QueryReportDto) {
    const orgId = await this.getOrganizationId();
    const dateFilter = this.getDateRangeFilter(query.startDate, query.endDate);

    const invoices = await this.prisma.salesInvoice.findMany({
      where: {
        organizationId: orgId,
        status: SalesInvoiceStatus.POSTED,
        ...(query.branchId ? { branchId: query.branchId } : {}),
        ...(dateFilter ? { invoiceDate: dateFilter } : {}),
      },
      include: {
        items: true,
      },
    });

    let totalRevenue = 0;
    let totalCogs = 0;
    let totalDiscount = 0;
    let totalTax = 0;

    for (const inv of invoices) {
      totalRevenue += Number(inv.netTotal);
      totalDiscount += Number(inv.discountAmount);
      totalTax += Number(inv.taxAmount);

      for (const item of inv.items) {
        totalCogs += Number(item.lineCost);
      }
    }

    const grossProfit = totalRevenue - totalCogs;
    const marginPercentage = totalRevenue > 0 ? (grossProfit / totalRevenue) * 100 : 0;

    return {
      invoiceCount: invoices.length,
      netRevenue: Number(totalRevenue.toFixed(2)),
      totalCogs: Number(totalCogs.toFixed(2)),
      grossProfit: Number(grossProfit.toFixed(2)),
      marginPercentage: Number(marginPercentage.toFixed(2)),
      totalDiscount: Number(totalDiscount.toFixed(2)),
      totalTax: Number(totalTax.toFixed(2)),
    };
  }

  // ==========================================
  // 7. OPERATIONAL DASHBOARD METRICS
  // ==========================================

  /**
   * Enhanced real-time operational dashboard KPIs.
   */
  async getDashboardMetrics(branchId?: string) {
    const orgId = await this.getOrganizationId();
    const now = new Date();

    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);

    const todayEnd = new Date(now);
    todayEnd.setHours(23, 59, 59, 999);

    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const [
      todayInvoices,
      monthInvoices,
      todayGrns,
      todayPayments,
      customers,
      suppliers,
      quarantineMovements,
      inTransitTransfers,
      batches,
    ] = await Promise.all([
      // 1. Today's Invoices
      this.prisma.salesInvoice.findMany({
        where: {
          organizationId: orgId,
          status: SalesInvoiceStatus.POSTED,
          invoiceDate: { gte: todayStart, lte: todayEnd },
          ...(branchId ? { branchId } : {}),
        },
        include: { items: true },
      }),

      // 2. Month-to-date Invoices
      this.prisma.salesInvoice.findMany({
        where: {
          organizationId: orgId,
          status: SalesInvoiceStatus.POSTED,
          invoiceDate: { gte: monthStart, lte: todayEnd },
          ...(branchId ? { branchId } : {}),
        },
        include: { items: true },
      }),

      // 3. Today's Purchases (GRNs)
      this.prisma.goodsReceiveNote.findMany({
        where: {
          organizationId: orgId,
          status: GrnStatus.POSTED,
          receivedDate: { gte: todayStart, lte: todayEnd },
          ...(branchId ? { branchId } : {}),
        },
      }),

      // 4. Today's Customer Payments / Collections
      this.prisma.customerPayment.findMany({
        where: {
          organizationId: orgId,
          status: CustomerPaymentStatus.POSTED,
          paymentDate: { gte: todayStart, lte: todayEnd },
          ...(branchId ? { branchId } : {}),
        },
      }),

      // 5. Customer Receivables
      this.prisma.customer.findMany({
        where: { organizationId: orgId },
        select: { currentBalance: true },
      }),

      // 6. Supplier Payables
      this.prisma.supplier.findMany({
        where: { organizationId: orgId },
        select: { currentBalance: true },
      }),

      // 7. Quarantined stock sum
      this.prisma.stockMovement.findMany({
        where: {
          organizationId: orgId,
          warehouse: { warehouseType: 'QUARANTINE' },
          ...(branchId ? { branchId } : {}),
        },
        select: { quantity: true },
      }),

      // 8. In-Transit stock transfers
      this.prisma.stockTransfer.findMany({
        where: {
          organizationId: orgId,
          status: { in: [StockTransferStatus.DISPATCHED, StockTransferStatus.PARTIALLY_RECEIVED] },
          ...(branchId ? { branchId } : {}),
        },
        include: { items: true },
      }),

      // 9. Batches for expiry counts
      this.prisma.batch.findMany({
        where: { product: { organizationId: orgId } },
        include: {
          stockMovements: {
            where: {
              organizationId: orgId,
              ...(branchId ? { branchId } : {}),
            },
          },
        },
      }),
    ]);

    // Today's sales calculations
    let todaySalesNet = 0;
    let todayCogs = 0;
    for (const inv of todayInvoices) {
      todaySalesNet += Number(inv.netTotal);
      for (const it of inv.items) {
        todayCogs += Number(it.lineCost);
      }
    }
    const todayGrossProfit = todaySalesNet - todayCogs;

    // Month-to-date sales calculations
    let mtdSalesNet = 0;
    let mtdCogs = 0;
    for (const inv of monthInvoices) {
      mtdSalesNet += Number(inv.netTotal);
      for (const it of inv.items) {
        mtdCogs += Number(it.lineCost);
      }
    }
    const mtdGrossProfit = mtdSalesNet - mtdCogs;

    // Today's purchases sum
    const todayPurchasesNet = todayGrns.reduce((sum, g) => sum + Number(g.netTotal), 0);

    // Today's collections sum
    const todayCollections = todayPayments.reduce((sum, p) => sum + Number(p.amount), 0);

    // Total outstanding receivables & payables
    const totalReceivables = customers.reduce(
      (sum, c) => sum + Math.max(0, Number(c.currentBalance)),
      0,
    );
    const totalPayables = suppliers.reduce(
      (sum, s) => sum + Math.max(0, Number(s.currentBalance)),
      0,
    );

    // Quarantined stock quantity
    const totalQuarantinedUnits = quarantineMovements.reduce(
      (sum, m) => sum + m.quantity,
      0,
    );

    // In-transit transfer units
    let totalInTransitUnits = 0;
    for (const trf of inTransitTransfers) {
      for (const it of trf.items) {
        totalInTransitUnits += Math.max(0, it.dispatchedQuantity - it.receivedQuantity);
      }
    }

    // Expiry counts
    let expiredBatchesCount = 0;
    let soonExpiringBatchesCount = 0; // <= 90 days
    const ninetyDaysAhead = new Date(now.getTime() + 90 * 86400000);

    for (const b of batches) {
      const stock = b.stockMovements.reduce((sum, m) => sum + m.quantity, 0);
      if (stock <= 0) continue;

      const exp = new Date(b.expiryDate);
      if (exp <= now) {
        expiredBatchesCount++;
      } else if (exp <= ninetyDaysAhead) {
        soonExpiringBatchesCount++;
      }
    }

    return {
      today: {
        salesNet: Number(todaySalesNet.toFixed(2)),
        purchasesNet: Number(todayPurchasesNet.toFixed(2)),
        collections: Number(todayCollections.toFixed(2)),
        grossProfit: Number(todayGrossProfit.toFixed(2)),
        invoiceCount: todayInvoices.length,
        grnCount: todayGrns.length,
      },
      monthToDate: {
        salesNet: Number(mtdSalesNet.toFixed(2)),
        grossProfit: Number(mtdGrossProfit.toFixed(2)),
        marginPercentage: mtdSalesNet > 0 ? Number(((mtdGrossProfit / mtdSalesNet) * 100).toFixed(2)) : 0,
      },
      outstanding: {
        receivables: Number(totalReceivables.toFixed(2)),
        payables: Number(totalPayables.toFixed(2)),
      },
      inventory: {
        quarantinedUnits: Math.max(0, totalQuarantinedUnits),
        inTransitUnits: totalInTransitUnits,
        expiredBatches: expiredBatchesCount,
        soonExpiringBatches: soonExpiringBatchesCount,
      },
    };
  }
}
