import {
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ReportsService } from './reports.service';
import {
  QueryReportDto,
  QueryCustomerStatementDto,
  QuerySupplierStatementDto,
} from './dto/query-reports.dto';
import {
  JwtAuthGuard,
  PermissionsGuard,
  RequirePermissions,
} from '../auth';

@Controller('reports')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  // ==========================================
  // SALES REPORTS
  // ==========================================

  @Get('sales/summary')
  @RequirePermissions('reports.view')
  async getSalesSummary(@Query() query: QueryReportDto) {
    return this.reportsService.getSalesSummary(query);
  }

  @Get('sales/register')
  @RequirePermissions('reports.view')
  async getSalesRegister(@Query() query: QueryReportDto) {
    return this.reportsService.getSalesRegister(query);
  }

  @Get('sales/product-wise')
  @RequirePermissions('reports.view')
  async getProductWiseSales(@Query() query: QueryReportDto) {
    return this.reportsService.getProductWiseSales(query);
  }

  @Get('sales/customer-wise')
  @RequirePermissions('reports.view')
  async getCustomerWiseSales(@Query() query: QueryReportDto) {
    return this.reportsService.getCustomerWiseSales(query);
  }

  @Get('sales/returns')
  @RequirePermissions('reports.view')
  async getSalesReturnsReport(@Query() query: QueryReportDto) {
    return this.reportsService.getSalesReturnsReport(query);
  }

  @Get('sales/collections')
  @RequirePermissions('reports.view')
  async getCollectionsReport(@Query() query: QueryReportDto) {
    return this.reportsService.getCollectionsReport(query);
  }

  // ==========================================
  // PURCHASE REPORTS
  // ==========================================

  @Get('purchases/summary')
  @RequirePermissions('reports.view')
  async getPurchaseSummary(@Query() query: QueryReportDto) {
    return this.reportsService.getPurchaseSummary(query);
  }

  @Get('purchases/register')
  @RequirePermissions('reports.view')
  async getPurchaseRegister(@Query() query: QueryReportDto) {
    return this.reportsService.getPurchaseRegister(query);
  }

  @Get('purchases/supplier-wise')
  @RequirePermissions('reports.view')
  async getSupplierWisePurchases(@Query() query: QueryReportDto) {
    return this.reportsService.getSupplierWisePurchases(query);
  }

  // ==========================================
  // INVENTORY REPORTS
  // ==========================================

  @Get('inventory/valuation')
  @RequirePermissions('reports.view')
  async getStockValuationReport(@Query() query: QueryReportDto) {
    return this.reportsService.getStockValuationReport(query);
  }

  @Get('inventory/ledger')
  @RequirePermissions('reports.view')
  async getStockLedgerReport(@Query() query: QueryReportDto) {
    return this.reportsService.getStockLedgerReport(query);
  }

  // ==========================================
  // CUSTOMER / RECEIVABLES REPORTS
  // ==========================================

  @Get('customers/aging')
  @RequirePermissions('reports.view')
  async getCustomerAgingReport(@Query() query: QueryReportDto) {
    return this.reportsService.getCustomerAgingReport(query);
  }

  @Get('customers/:customerId/statement')
  @RequirePermissions('reports.view')
  async getCustomerStatement(
    @Param('customerId') customerId: string,
    @Query() query: QueryCustomerStatementDto,
  ) {
    return this.reportsService.getCustomerStatement(customerId, query);
  }

  // ==========================================
  // SUPPLIER / PAYABLES REPORTS
  // ==========================================

  @Get('suppliers/aging')
  @RequirePermissions('reports.view')
  async getSupplierAgingReport(@Query() query: QueryReportDto) {
    return this.reportsService.getSupplierAgingReport(query);
  }

  @Get('suppliers/:supplierId/statement')
  @RequirePermissions('reports.view')
  async getSupplierStatement(
    @Param('supplierId') supplierId: string,
    @Query() query: QuerySupplierStatementDto,
  ) {
    return this.reportsService.getSupplierStatement(supplierId, query);
  }

  // ==========================================
  // PROFITABILITY REPORTS
  // ==========================================

  @Get('profitability/summary')
  @RequirePermissions('reports.view')
  async getProfitabilitySummary(@Query() query: QueryReportDto) {
    return this.reportsService.getProfitabilitySummary(query);
  }

  // ==========================================
  // CASH RECONCILIATION & TILL REPORTS (Phase 20F)
  // ==========================================

  @Get('cash/sessions')
  @RequirePermissions('reports.view')
  async getTillSessionsReport(@Query() query: QueryReportDto) {
    return this.reportsService.getTillSessionsReport(query);
  }

  @Get('cash/daily-reconciliation')
  @RequirePermissions('reports.view')
  async getDailyCashReconciliation(@Query() query: QueryReportDto) {
    return this.reportsService.getDailyCashReconciliation(query);
  }

  @Get('cash/variances')
  @RequirePermissions('reports.view')
  async getCashVariancesReport(@Query() query: QueryReportDto) {
    return this.reportsService.getCashVariancesReport(query);
  }

  // ==========================================
  // DASHBOARD OPERATIONAL METRICS
  // ==========================================

  @Get('dashboard/metrics')
  @RequirePermissions('reports.view')
  async getDashboardMetrics(@Query('branchId') branchId?: string) {
    return this.reportsService.getDashboardMetrics(branchId);
  }
}
