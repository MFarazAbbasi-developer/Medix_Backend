import {
  Injectable,
  ConflictException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import {
  ImportType,
  ImportJobStatus,
  StockMovementType,
  CustomerLedgerEntryType,
  SupplierLedgerEntryType,
  Prisma,
} from '@prisma/client';

@Injectable()
export class ImportExecutorService {
  private readonly logger = new Logger(ImportExecutorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  /**
   * Atomically executes a confirmed import job within a single database transaction.
   * If any record fails or database constraint is violated, the entire transaction is rolled back.
   */
  async executeImport(jobId: string, userId?: string) {
    // 1. Fetch import job
    const job = await this.prisma.importJob.findUnique({
      where: { id: jobId },
      include: { organization: true },
    });

    if (!job) {
      throw new BadRequestException(`Import job with ID "${jobId}" not found.`);
    }

    if (job.status !== ImportJobStatus.READY) {
      throw new ConflictException(
        `Import job is in status "${job.status}". Only jobs in "READY" status can be confirmed for execution.`,
      );
    }

    const metadata = (job.metadata as Record<string, unknown>) || {};
    const parsedPayload = (metadata.parsedPayload as Array<Record<string, unknown>>) || [];

    if (!parsedPayload || parsedPayload.length === 0) {
      throw new BadRequestException('Import job contains no valid records to import.');
    }

    const orgId = job.organizationId;
    const branchId = job.branchId;

    // 2. Atomically transition job status to IMPORTING to prevent double clicks and race conditions
    const updateResult = await this.prisma.importJob.updateMany({
      where: {
        id: jobId,
        status: ImportJobStatus.READY,
      },
      data: {
        status: ImportJobStatus.IMPORTING,
        startedAt: new Date(),
      },
    });

    if (updateResult.count === 0) {
      throw new ConflictException('Import job is already currently importing or was already processed.');
    }

    // 3. Run transactional domain execution
    try {
      await this.prisma.$transaction(
        async (tx) => {
          switch (job.type) {
            case ImportType.PRODUCTS:
              await this.executeProductsImport(tx, orgId, parsedPayload, job.id);
              break;
            case ImportType.CUSTOMERS:
              await this.executeCustomersImport(tx, orgId, parsedPayload, job.id);
              break;
            case ImportType.SUPPLIERS:
              await this.executeSuppliersImport(tx, orgId, parsedPayload, job.id);
              break;
            case ImportType.OPENING_STOCK:
              await this.executeOpeningStockImport(tx, orgId, parsedPayload, job.id, userId);
              break;
            case ImportType.CUSTOMER_OPENING_BALANCES:
              await this.executeCustomerBalancesImport(tx, orgId, parsedPayload, job.id, userId);
              break;
            case ImportType.SUPPLIER_OPENING_BALANCES:
              await this.executeSupplierBalancesImport(tx, orgId, parsedPayload, job.id, userId);
              break;
            default:
              throw new BadRequestException(`Unsupported import type: ${job.type}`);
          }

          // Mark job COMPLETED inside transaction
          await tx.importJob.update({
            where: { id: jobId },
            data: {
              status: ImportJobStatus.COMPLETED,
              completedAt: new Date(),
              importedRows: parsedPayload.length,
              failedRows: 0,
            },
          });
        },
        {
          timeout: 60000, // 60s timeout for large datasets
        },
      );

      // Log successful execution in audit log
      await this.auditService.log({
        userId,
        action: 'EXECUTE_IMPORT',
        entity: 'IMPORT_JOB',
        entityId: job.id,
        details: {
          type: job.type,
          originalFilename: job.originalFilename,
          totalRows: job.totalRows,
          importedRows: parsedPayload.length,
          summary: metadata.summary,
        },
      });

      return this.prisma.importJob.findUnique({
        where: { id: jobId },
      });
    } catch (error) {
      const errMsg = (error as Error).message;
      this.logger.error(`Import job "${jobId}" failed during transactional execution: ${errMsg}`);

      // Outside the rolled-back transaction, update job status to FAILED
      await this.prisma.importJob.update({
        where: { id: jobId },
        data: {
          status: ImportJobStatus.FAILED,
          completedAt: new Date(),
          failedRows: parsedPayload.length,
          metadata: {
            ...metadata,
            failureReason: errMsg,
          },
        },
      });

      throw new BadRequestException(`Import execution failed and rolled back: ${errMsg}`);
    }
  }

  // =========================================================================
  // 1. PRODUCTS EXECUTION
  // =========================================================================
  private async executeProductsImport(
    tx: Prisma.TransactionClient,
    organizationId: string,
    rows: Array<Record<string, unknown>>,
    jobId: string,
  ): Promise<void> {
    // Revalidate SKUs inside transaction
    const skus = rows.map((r) => String(r.sku).trim().toUpperCase());
    const existing = await tx.product.findMany({
      where: {
        organizationId,
        sku: { in: skus, mode: 'insensitive' },
      },
      select: { sku: true },
    });

    if (existing.length > 0) {
      throw new ConflictException(
        `Database conflict: SKU(s) already exist: ${existing.map((e) => e.sku).join(', ')}. Imports are create-only.`,
      );
    }

    for (const row of rows) {
      await tx.product.create({
        data: {
          organizationId,
          sku: String(row.sku).trim(),
          name: String(row.name).trim(),
          genericName: String(row.genericName).trim(),
          manufacturerId: (row.manufacturerId as string) || null,
          categoryId: (row.categoryId as string) || null,
          unitId: (row.unitId as string) || null,
          dosageForm: (row.dosageForm as string) || null,
          strength: (row.strength as string) || null,
          packSize: (row.packSize as string) || null,
          barcode: (row.barcode as string) || null,
          taxPercentage: new Prisma.Decimal(Number(row.taxPercentage || 0)),
          description: (row.description as string) || null,
          isActive: row.isActive !== false,
        },
      });
    }
  }

  // =========================================================================
  // 2. CUSTOMERS EXECUTION
  // =========================================================================
  private async executeCustomersImport(
    tx: Prisma.TransactionClient,
    organizationId: string,
    rows: Array<Record<string, unknown>>,
    jobId: string,
  ): Promise<void> {
    const codes = rows.map((r) => String(r.code).trim().toUpperCase());
    const existing = await tx.customer.findMany({
      where: {
        organizationId,
        code: { in: codes, mode: 'insensitive' },
      },
      select: { code: true },
    });

    if (existing.length > 0) {
      throw new ConflictException(
        `Database conflict: Customer code(s) already exist: ${existing.map((e) => e.code).join(', ')}.`,
      );
    }

    for (const row of rows) {
      await tx.customer.create({
        data: {
          organizationId,
          code: String(row.code).trim().toUpperCase(),
          name: String(row.name).trim(),
          customerType: (row.customerType as any) || 'RETAIL_PHARMACY',
          contactPerson: (row.contactPerson as string) || null,
          phone: (row.phone as string) || null,
          email: (row.email as string) || null,
          address: (row.address as string) || null,
          city: (row.city as string) || null,
          ntn: (row.ntn as string) || null,
          strn: (row.strn as string) || null,
          drugSaleLicenseNo: (row.drugSaleLicenseNo as string) || null,
          creditDays: Number(row.creditDays || 0),
          creditLimit: new Prisma.Decimal(Number(row.creditLimit || 0)),
          currentBalance: new Prisma.Decimal(0), // Rule #2: Opening balance not created here
          defaultDiscountPercentage: new Prisma.Decimal(Number(row.defaultDiscountPercentage || 0)),
          isTaxExempt: Boolean(row.isTaxExempt),
          isActive: row.isActive !== false,
        },
      });
    }
  }

  // =========================================================================
  // 3. SUPPLIERS EXECUTION
  // =========================================================================
  private async executeSuppliersImport(
    tx: Prisma.TransactionClient,
    organizationId: string,
    rows: Array<Record<string, unknown>>,
    jobId: string,
  ): Promise<void> {
    const codes = rows.map((r) => String(r.code).trim().toUpperCase());
    const existing = await tx.supplier.findMany({
      where: {
        organizationId,
        code: { in: codes, mode: 'insensitive' },
      },
      select: { code: true },
    });

    if (existing.length > 0) {
      throw new ConflictException(
        `Database conflict: Supplier code(s) already exist: ${existing.map((e) => e.code).join(', ')}.`,
      );
    }

    for (const row of rows) {
      await tx.supplier.create({
        data: {
          organizationId,
          code: String(row.code).trim().toUpperCase(),
          name: String(row.name).trim(),
          contactPerson: (row.contactPerson as string) || null,
          phone: (row.phone as string) || null,
          email: (row.email as string) || null,
          address: (row.address as string) || null,
          city: (row.city as string) || null,
          ntn: (row.ntn as string) || null,
          strn: (row.strn as string) || null,
          drugLicenseNo: (row.drugLicenseNo as string) || null,
          creditDays: Number(row.creditDays || 30),
          creditLimit: new Prisma.Decimal(Number(row.creditLimit || 0)),
          currentBalance: new Prisma.Decimal(0), // Rule #2: Opening balance not created here
          isActive: row.isActive !== false,
        },
      });
    }
  }

  // =========================================================================
  // 4. OPENING STOCK EXECUTION
  // =========================================================================
  private async executeOpeningStockImport(
    tx: Prisma.TransactionClient,
    organizationId: string,
    rows: Array<Record<string, unknown>>,
    jobId: string,
    userId?: string,
  ): Promise<void> {
    for (const row of rows) {
      const productId = String(row.productId);
      const batchNumber = String(row.batchNumber).trim();
      const warehouseId = String(row.warehouseId);
      const branchId = String(row.branchId);
      const quantity = Number(row.quantity);
      const cost = Number(row.purchaseCost);
      const tp = Number(row.tradePrice || cost);
      const mrp = Number(row.retailPrice || tp);
      const expiryDate = new Date(String(row.expiryDate));
      const mfgDate = row.mfgDate ? new Date(String(row.mfgDate)) : null;

      // Find or create batch
      let batch = await tx.batch.findUnique({
        where: {
          productId_batchNumber: {
            productId,
            batchNumber,
          },
        },
      });

      if (!batch) {
        batch = await tx.batch.create({
          data: {
            productId,
            batchNumber,
            mfgDate,
            expiryDate,
            purchaseCost: new Prisma.Decimal(cost),
            tradePrice: new Prisma.Decimal(tp),
            retailPrice: new Prisma.Decimal(mrp),
            status: 'ACTIVE',
            remarks: 'Created via Opening Stock Import',
          },
        });
      } else {
        // Re-verify conflict inside transaction
        const dbExpiryStr = batch.expiryDate.toISOString().slice(0, 10);
        const fileExpiryStr = expiryDate.toISOString().slice(0, 10);
        if (dbExpiryStr !== fileExpiryStr) {
          throw new ConflictException(
            `Batch "${batchNumber}" has conflicting expiry date in database (${dbExpiryStr} vs ${fileExpiryStr}).`,
          );
        }
      }

      // Acquire batch lock
      await tx.$queryRaw`SELECT "id" FROM "batches" WHERE "id" = ${batch.id} FOR UPDATE;`;

      // Create Stock Movement Ledger entry
      await tx.stockMovement.create({
        data: {
          organizationId,
          branchId,
          warehouseId,
          productId,
          batchId: batch.id,
          movementType: StockMovementType.OPENING_BALANCE,
          quantity,
          unitCost: new Prisma.Decimal(cost),
          referenceType: 'IMPORT_JOB',
          referenceId: jobId,
          notes: `Opening stock import (Job ${jobId.slice(0, 8)})`,
          createdByUserId: userId || null,
        },
      });
    }
  }

  // =========================================================================
  // 5. CUSTOMER OPENING BALANCES EXECUTION
  // =========================================================================
  private async executeCustomerBalancesImport(
    tx: Prisma.TransactionClient,
    organizationId: string,
    rows: Array<Record<string, unknown>>,
    jobId: string,
    userId?: string,
  ): Promise<void> {
    // Sort customer IDs to enforce strict deterministic locking order and prevent deadlocks
    const sortedRows = [...rows].sort((a, b) => String(a.customerId).localeCompare(String(b.customerId)));

    const referenceNumber = `IMPORT-${jobId.slice(0, 8)}`;

    for (const row of sortedRows) {
      const customerId = String(row.customerId);
      const branchId = String(row.branchId);
      const amount = Number(row.amount);
      const notes = (row.notes as string) || `Customer opening balance import (${referenceNumber})`;

      // Acquire Customer row lock
      await tx.$queryRaw`SELECT "id" FROM "customers" WHERE "id" = ${customerId} FOR UPDATE;`;

      const customer = await tx.customer.findUnique({
        where: { id: customerId },
      });

      if (!customer) {
        throw new BadRequestException(`Customer with ID "${customerId}" not found.`);
      }

      // Idempotency / Duplicate Check
      const existingEntry = await tx.customerLedgerEntry.findFirst({
        where: {
          customerId,
          referenceNumber,
        },
      });

      if (existingEntry) {
        throw new ConflictException(
          `Customer "${customer.code}" already has an opening balance entry for import job ${referenceNumber}.`,
        );
      }

      const prevBalance = Number(customer.currentBalance);
      const newBalance = prevBalance + amount;

      // Customer opening balance positive = customer owes us (Debit)
      await tx.customerLedgerEntry.create({
        data: {
          organizationId,
          branchId,
          customerId,
          entryType: CustomerLedgerEntryType.OPENING_BALANCE,
          referenceNumber,
          debit: new Prisma.Decimal(amount),
          credit: new Prisma.Decimal(0),
          runningBalance: new Prisma.Decimal(newBalance),
          notes,
          createdByUserId: userId || null,
        },
      });

      // Update cached customer current balance
      await tx.customer.update({
        where: { id: customerId },
        data: {
          currentBalance: new Prisma.Decimal(newBalance),
        },
      });
    }
  }

  // =========================================================================
  // 6. SUPPLIER OPENING BALANCES EXECUTION
  // =========================================================================
  private async executeSupplierBalancesImport(
    tx: Prisma.TransactionClient,
    organizationId: string,
    rows: Array<Record<string, unknown>>,
    jobId: string,
    userId?: string,
  ): Promise<void> {
    const sortedRows = [...rows].sort((a, b) => String(a.supplierId).localeCompare(String(b.supplierId)));

    const referenceNumber = `IMPORT-${jobId.slice(0, 8)}`;

    for (const row of sortedRows) {
      const supplierId = String(row.supplierId);
      const branchId = String(row.branchId);
      const amount = Number(row.amount);
      const notes = (row.notes as string) || `Supplier opening balance import (${referenceNumber})`;

      // Acquire Supplier row lock
      await tx.$queryRaw`SELECT "id" FROM "suppliers" WHERE "id" = ${supplierId} FOR UPDATE;`;

      const supplier = await tx.supplier.findUnique({
        where: { id: supplierId },
      });

      if (!supplier) {
        throw new BadRequestException(`Supplier with ID "${supplierId}" not found.`);
      }

      // Idempotency / Duplicate Check
      const existingEntry = await tx.supplierLedgerEntry.findFirst({
        where: {
          supplierId,
          referenceNumber,
        },
      });

      if (existingEntry) {
        throw new ConflictException(
          `Supplier "${supplier.code}" already has an opening balance entry for import job ${referenceNumber}.`,
        );
      }

      const prevBalance = Number(supplier.currentBalance);
      const newBalance = prevBalance + amount;

      // Supplier opening balance positive = we owe supplier (Credit)
      await tx.supplierLedgerEntry.create({
        data: {
          organizationId,
          branchId,
          supplierId,
          entryType: SupplierLedgerEntryType.OPENING_BALANCE,
          referenceNumber,
          debit: new Prisma.Decimal(0),
          credit: new Prisma.Decimal(amount),
          runningBalance: new Prisma.Decimal(newBalance),
          notes,
          createdByUserId: userId || null,
        },
      });

      // Update cached supplier current balance
      await tx.supplier.update({
        where: { id: supplierId },
        data: {
          currentBalance: new Prisma.Decimal(newBalance),
        },
      });
    }
  }
}
