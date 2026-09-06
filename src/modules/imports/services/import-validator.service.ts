import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  ImportType,
  CustomerType,
  Prisma,
} from '@prisma/client';
import {
  ImportRowError,
  ImportRowWarning,
  ImportValidationResult,
} from '../interfaces/import.interfaces';

@Injectable()
export class ImportValidatorService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Validates parsed spreadsheet rows for a given ImportType.
   * Performs read-only lookup and reference resolution against the database.
   */
  async validate(
    type: ImportType,
    organizationId: string,
    rows: Array<Record<string, unknown>>,
    defaultBranchId?: string,
  ): Promise<ImportValidationResult> {
    switch (type) {
      case ImportType.PRODUCTS:
        return this.validateProducts(organizationId, rows);
      case ImportType.CUSTOMERS:
        return this.validateCustomers(organizationId, rows);
      case ImportType.SUPPLIERS:
        return this.validateSuppliers(organizationId, rows);
      case ImportType.OPENING_STOCK:
        return this.validateOpeningStock(organizationId, rows, defaultBranchId);
      case ImportType.CUSTOMER_OPENING_BALANCES:
        return this.validateCustomerOpeningBalances(organizationId, rows, defaultBranchId);
      case ImportType.SUPPLIER_OPENING_BALANCES:
        return this.validateSupplierOpeningBalances(organizationId, rows, defaultBranchId);
      default:
        throw new BadRequestException(`Unsupported import type: ${type}`);
    }
  }

  // =========================================================================
  // 1. PRODUCTS VALIDATION
  // =========================================================================
  private async validateProducts(
    organizationId: string,
    rows: Array<Record<string, unknown>>,
  ): Promise<ImportValidationResult> {
    const errors: ImportRowError[] = [];
    const warnings: ImportRowWarning[] = [];
    const previewRows: Array<Record<string, unknown> & { _row: number; _valid: boolean; _errors?: string[] }> = [];

    // Pre-fetch reference maps for fast O(1) lookup
    const [existingProducts, manufacturers, categories, units] = await Promise.all([
      this.prisma.product.findMany({
        where: { organizationId },
        select: { sku: true, barcode: true },
      }),
      this.prisma.manufacturer.findMany({
        where: { organizationId },
        select: { id: true, name: true, code: true },
      }),
      this.prisma.productCategory.findMany({
        where: { organizationId },
        select: { id: true, name: true, code: true },
      }),
      this.prisma.unitOfMeasurement.findMany({
        where: { organizationId },
        select: { id: true, name: true, symbol: true },
      }),
    ]);

    const existingSkus = new Set(existingProducts.map((p) => p.sku.trim().toUpperCase()));
    const seenSkusInFile = new Set<string>();

    const mfgMap = new Map<string, string>();
    manufacturers.forEach((m) => {
      mfgMap.set(m.name.toLowerCase().trim(), m.id);
      if (m.code) mfgMap.set(m.code.toLowerCase().trim(), m.id);
    });

    const catMap = new Map<string, string>();
    categories.forEach((c) => {
      catMap.set(c.name.toLowerCase().trim(), c.id);
      if (c.code) catMap.set(c.code.toLowerCase().trim(), c.id);
    });

    const unitMap = new Map<string, string>();
    units.forEach((u) => {
      unitMap.set(u.symbol.toLowerCase().trim(), u.id);
      unitMap.set(u.name.toLowerCase().trim(), u.id);
    });

    const validParsedRows: Array<Record<string, unknown>> = [];

    for (let i = 0; i < rows.length; i++) {
      const rowNum = i + 1;
      const row = rows[i];
      const rowErrors: string[] = [];

      const rawSku = row.sku ? String(row.sku).trim() : '';
      const rawName = row.name ? String(row.name).trim() : '';
      const rawGenericName = row.genericName ? String(row.genericName).trim() : '';

      // 1. Mandatory Fields
      if (!rawSku) {
        const msg = 'SKU is required.';
        errors.push({ row: rowNum, field: 'sku', code: 'MISSING_REQUIRED_FIELD', message: msg });
        rowErrors.push(msg);
      }
      if (!rawName) {
        const msg = 'Product Name is required.';
        errors.push({ row: rowNum, field: 'name', code: 'MISSING_REQUIRED_FIELD', message: msg });
        rowErrors.push(msg);
      }
      if (!rawGenericName) {
        const msg = 'Generic Name is required.';
        errors.push({ row: rowNum, field: 'genericName', code: 'MISSING_REQUIRED_FIELD', message: msg });
        rowErrors.push(msg);
      }

      // 2. Uniqueness & Duplicate In File / Database
      const upperSku = rawSku.toUpperCase();
      if (rawSku) {
        if (seenSkusInFile.has(upperSku)) {
          const msg = `Duplicate SKU "${rawSku}" found multiple times in upload file.`;
          errors.push({ row: rowNum, field: 'sku', code: 'DUPLICATE_SKU_IN_FILE', message: msg, value: rawSku });
          rowErrors.push(msg);
        } else {
          seenSkusInFile.add(upperSku);
        }

        if (existingSkus.has(upperSku)) {
          const msg = `SKU "${rawSku}" already exists in the system. Imports are create-only.`;
          errors.push({ row: rowNum, field: 'sku', code: 'DUPLICATE_SKU', message: msg, value: rawSku });
          rowErrors.push(msg);
        }
      }

      // 3. Manufacturer Resolution
      let resolvedMfgId: string | null = null;
      if (row.manufacturer) {
        const mfgKey = String(row.manufacturer).toLowerCase().trim();
        resolvedMfgId = mfgMap.get(mfgKey) || null;
        if (!resolvedMfgId) {
          const msg = `Manufacturer "${row.manufacturer}" could not be resolved.`;
          errors.push({ row: rowNum, field: 'manufacturer', code: 'UNKNOWN_MANUFACTURER', message: msg, value: row.manufacturer });
          rowErrors.push(msg);
        }
      }

      // 4. Category Resolution
      let resolvedCatId: string | null = null;
      if (row.category) {
        const catKey = String(row.category).toLowerCase().trim();
        resolvedCatId = catMap.get(catKey) || null;
        if (!resolvedCatId) {
          const msg = `Product Category "${row.category}" could not be resolved.`;
          errors.push({ row: rowNum, field: 'category', code: 'UNKNOWN_CATEGORY', message: msg, value: row.category });
          rowErrors.push(msg);
        }
      }

      // 5. Unit Resolution
      let resolvedUnitId: string | null = null;
      if (row.unit) {
        const unitKey = String(row.unit).toLowerCase().trim();
        resolvedUnitId = unitMap.get(unitKey) || null;
        if (!resolvedUnitId) {
          const msg = `Unit of Measurement "${row.unit}" could not be resolved.`;
          errors.push({ row: rowNum, field: 'unit', code: 'UNKNOWN_UNIT', message: msg, value: row.unit });
          rowErrors.push(msg);
        }
      }

      // 6. Tax Percentage
      let tax = 0;
      if (row.taxPercentage !== undefined && row.taxPercentage !== null && String(row.taxPercentage).trim() !== '') {
        tax = Number(row.taxPercentage);
        if (isNaN(tax) || tax < 0 || tax > 100) {
          const msg = `Tax percentage must be a number between 0 and 100. Received "${row.taxPercentage}".`;
          errors.push({ row: rowNum, field: 'taxPercentage', code: 'INVALID_TAX_PERCENTAGE', message: msg, value: row.taxPercentage });
          rowErrors.push(msg);
        }
      }

      const isValid = rowErrors.length === 0;

      if (isValid) {
        validParsedRows.push({
          sku: rawSku,
          name: rawName,
          genericName: rawGenericName,
          manufacturerId: resolvedMfgId,
          categoryId: resolvedCatId,
          unitId: resolvedUnitId,
          dosageForm: row.dosageForm ? String(row.dosageForm).trim() : null,
          strength: row.strength ? String(row.strength).trim() : null,
          packSize: row.packSize ? String(row.packSize).trim() : null,
          barcode: row.barcode ? String(row.barcode).trim() : null,
          taxPercentage: tax,
          description: row.description ? String(row.description).trim() : null,
          isActive: row.isActive === undefined || row.isActive === null ? true : String(row.isActive).toLowerCase() !== 'false',
        });
      }

      previewRows.push({
        ...row,
        _row: rowNum,
        _valid: isValid,
        ...(rowErrors.length > 0 && { _errors: rowErrors }),
      });
    }

    const validRows = previewRows.filter((r) => r._valid).length;
    const invalidRows = previewRows.length - validRows;

    return {
      totalRows: rows.length,
      validRows,
      invalidRows,
      errors,
      warnings,
      summary: {
        totalProducts: rows.length,
        validProducts: validRows,
        invalidProducts: invalidRows,
        unresolvedManufacturers: errors.filter((e) => e.code === 'UNKNOWN_MANUFACTURER').length,
        unresolvedCategories: errors.filter((e) => e.code === 'UNKNOWN_CATEGORY').length,
        unresolvedUnits: errors.filter((e) => e.code === 'UNKNOWN_UNIT').length,
      },
      previewRows,
      parsedRows: validParsedRows,
    };
  }

  // =========================================================================
  // 2. CUSTOMERS VALIDATION
  // =========================================================================
  private async validateCustomers(
    organizationId: string,
    rows: Array<Record<string, unknown>>,
  ): Promise<ImportValidationResult> {
    const errors: ImportRowError[] = [];
    const warnings: ImportRowWarning[] = [];
    const previewRows: Array<Record<string, unknown> & { _row: number; _valid: boolean; _errors?: string[] }> = [];

    const existingCustomers = await this.prisma.customer.findMany({
      where: { organizationId },
      select: { code: true },
    });

    const existingCodes = new Set(existingCustomers.map((c) => c.code.trim().toUpperCase()));
    const seenCodesInFile = new Set<string>();

    const validCustomerTypes = new Set(Object.values(CustomerType));
    const validParsedRows: Array<Record<string, unknown>> = [];

    for (let i = 0; i < rows.length; i++) {
      const rowNum = i + 1;
      const row = rows[i];
      const rowErrors: string[] = [];

      const rawCode = row.code ? String(row.code).trim() : '';
      const rawName = row.name ? String(row.name).trim() : '';

      if (!rawCode) {
        const msg = 'Customer Code is required.';
        errors.push({ row: rowNum, field: 'code', code: 'MISSING_REQUIRED_FIELD', message: msg });
        rowErrors.push(msg);
      }
      if (!rawName) {
        const msg = 'Customer Name is required.';
        errors.push({ row: rowNum, field: 'name', code: 'MISSING_REQUIRED_FIELD', message: msg });
        rowErrors.push(msg);
      }

      const upperCode = rawCode.toUpperCase();
      if (rawCode) {
        if (seenCodesInFile.has(upperCode)) {
          const msg = `Duplicate Customer Code "${rawCode}" in file.`;
          errors.push({ row: rowNum, field: 'code', code: 'DUPLICATE_CUSTOMER_CODE_IN_FILE', message: msg, value: rawCode });
          rowErrors.push(msg);
        } else {
          seenCodesInFile.add(upperCode);
        }

        if (existingCodes.has(upperCode)) {
          const msg = `Customer Code "${rawCode}" already exists. Customer imports are create-only.`;
          errors.push({ row: rowNum, field: 'code', code: 'DUPLICATE_CUSTOMER_CODE', message: msg, value: rawCode });
          rowErrors.push(msg);
        }
      }

      // Customer Type
      let customerType: CustomerType = CustomerType.RETAIL_PHARMACY;
      if (row.customerType) {
        const formattedType = String(row.customerType).trim().toUpperCase() as CustomerType;
        if (validCustomerTypes.has(formattedType)) {
          customerType = formattedType;
        } else {
          const msg = `Invalid customer type "${row.customerType}". Valid values: ${Array.from(validCustomerTypes).join(', ')}`;
          errors.push({ row: rowNum, field: 'customerType', code: 'INVALID_CUSTOMER_TYPE', message: msg, value: row.customerType });
          rowErrors.push(msg);
        }
      }

      // Credit Days
      let creditDays = 0;
      if (row.creditDays !== undefined && row.creditDays !== null && String(row.creditDays).trim() !== '') {
        creditDays = Number(row.creditDays);
        if (isNaN(creditDays) || creditDays < 0 || !Number.isInteger(creditDays)) {
          const msg = `Credit days must be a non-negative integer. Received "${row.creditDays}".`;
          errors.push({ row: rowNum, field: 'creditDays', code: 'INVALID_CREDIT_DAYS', message: msg, value: row.creditDays });
          rowErrors.push(msg);
        }
      }

      // Credit Limit
      let creditLimit = 0;
      if (row.creditLimit !== undefined && row.creditLimit !== null && String(row.creditLimit).trim() !== '') {
        creditLimit = Number(row.creditLimit);
        if (isNaN(creditLimit) || creditLimit < 0) {
          const msg = `Credit limit must be a non-negative number. Received "${row.creditLimit}".`;
          errors.push({ row: rowNum, field: 'creditLimit', code: 'INVALID_CREDIT_LIMIT', message: msg, value: row.creditLimit });
          rowErrors.push(msg);
        }
      }

      // Default Discount
      let defaultDiscount = 0;
      if (row.defaultDiscountPercentage !== undefined && row.defaultDiscountPercentage !== null && String(row.defaultDiscountPercentage).trim() !== '') {
        defaultDiscount = Number(row.defaultDiscountPercentage);
        if (isNaN(defaultDiscount) || defaultDiscount < 0 || defaultDiscount > 100) {
          const msg = `Default discount must be between 0 and 100%. Received "${row.defaultDiscountPercentage}".`;
          errors.push({ row: rowNum, field: 'defaultDiscountPercentage', code: 'INVALID_DISCOUNT', message: msg, value: row.defaultDiscountPercentage });
          rowErrors.push(msg);
        }
      }

      const isValid = rowErrors.length === 0;

      if (isValid) {
        validParsedRows.push({
          code: rawCode,
          name: rawName,
          customerType,
          contactPerson: row.contactPerson ? String(row.contactPerson).trim() : null,
          phone: row.phone ? String(row.phone).trim() : null,
          email: row.email ? String(row.email).trim() : null,
          address: row.address ? String(row.address).trim() : null,
          city: row.city ? String(row.city).trim() : null,
          ntn: row.ntn ? String(row.ntn).trim() : null,
          strn: row.strn ? String(row.strn).trim() : null,
          drugSaleLicenseNo: row.drugSaleLicenseNo ? String(row.drugSaleLicenseNo).trim() : null,
          creditDays,
          creditLimit,
          defaultDiscountPercentage: defaultDiscount,
          isTaxExempt: row.isTaxExempt ? String(row.isTaxExempt).toLowerCase() === 'true' : false,
          isActive: row.isActive === undefined || row.isActive === null ? true : String(row.isActive).toLowerCase() !== 'false',
        });
      }

      previewRows.push({
        ...row,
        _row: rowNum,
        _valid: isValid,
        ...(rowErrors.length > 0 && { _errors: rowErrors }),
      });
    }

    const validRows = previewRows.filter((r) => r._valid).length;
    const invalidRows = previewRows.length - validRows;

    return {
      totalRows: rows.length,
      validRows,
      invalidRows,
      errors,
      warnings,
      summary: {
        totalCustomers: rows.length,
        validCustomers: validRows,
        invalidCustomers: invalidRows,
      },
      previewRows,
      parsedRows: validParsedRows,
    };
  }

  // =========================================================================
  // 3. SUPPLIERS VALIDATION
  // =========================================================================
  private async validateSuppliers(
    organizationId: string,
    rows: Array<Record<string, unknown>>,
  ): Promise<ImportValidationResult> {
    const errors: ImportRowError[] = [];
    const warnings: ImportRowWarning[] = [];
    const previewRows: Array<Record<string, unknown> & { _row: number; _valid: boolean; _errors?: string[] }> = [];

    const existingSuppliers = await this.prisma.supplier.findMany({
      where: { organizationId },
      select: { code: true },
    });

    const existingCodes = new Set(existingSuppliers.map((s) => s.code.trim().toUpperCase()));
    const seenCodesInFile = new Set<string>();
    const validParsedRows: Array<Record<string, unknown>> = [];

    for (let i = 0; i < rows.length; i++) {
      const rowNum = i + 1;
      const row = rows[i];
      const rowErrors: string[] = [];

      const rawCode = row.code ? String(row.code).trim() : '';
      const rawName = row.name ? String(row.name).trim() : '';

      if (!rawCode) {
        const msg = 'Supplier Code is required.';
        errors.push({ row: rowNum, field: 'code', code: 'MISSING_REQUIRED_FIELD', message: msg });
        rowErrors.push(msg);
      }
      if (!rawName) {
        const msg = 'Supplier Name is required.';
        errors.push({ row: rowNum, field: 'name', code: 'MISSING_REQUIRED_FIELD', message: msg });
        rowErrors.push(msg);
      }

      const upperCode = rawCode.toUpperCase();
      if (rawCode) {
        if (seenCodesInFile.has(upperCode)) {
          const msg = `Duplicate Supplier Code "${rawCode}" in file.`;
          errors.push({ row: rowNum, field: 'code', code: 'DUPLICATE_SUPPLIER_CODE_IN_FILE', message: msg, value: rawCode });
          rowErrors.push(msg);
        } else {
          seenCodesInFile.add(upperCode);
        }

        if (existingCodes.has(upperCode)) {
          const msg = `Supplier Code "${rawCode}" already exists. Supplier imports are create-only.`;
          errors.push({ row: rowNum, field: 'code', code: 'DUPLICATE_SUPPLIER_CODE', message: msg, value: rawCode });
          rowErrors.push(msg);
        }
      }

      // Credit Days
      let creditDays = 30;
      if (row.creditDays !== undefined && row.creditDays !== null && String(row.creditDays).trim() !== '') {
        creditDays = Number(row.creditDays);
        if (isNaN(creditDays) || creditDays < 0 || !Number.isInteger(creditDays)) {
          const msg = `Credit days must be a non-negative integer. Received "${row.creditDays}".`;
          errors.push({ row: rowNum, field: 'creditDays', code: 'INVALID_CREDIT_DAYS', message: msg, value: row.creditDays });
          rowErrors.push(msg);
        }
      }

      // Credit Limit
      let creditLimit = 0;
      if (row.creditLimit !== undefined && row.creditLimit !== null && String(row.creditLimit).trim() !== '') {
        creditLimit = Number(row.creditLimit);
        if (isNaN(creditLimit) || creditLimit < 0) {
          const msg = `Credit limit must be a non-negative number. Received "${row.creditLimit}".`;
          errors.push({ row: rowNum, field: 'creditLimit', code: 'INVALID_CREDIT_LIMIT', message: msg, value: row.creditLimit });
          rowErrors.push(msg);
        }
      }

      const isValid = rowErrors.length === 0;

      if (isValid) {
        validParsedRows.push({
          code: rawCode,
          name: rawName,
          contactPerson: row.contactPerson ? String(row.contactPerson).trim() : null,
          phone: row.phone ? String(row.phone).trim() : null,
          email: row.email ? String(row.email).trim() : null,
          address: row.address ? String(row.address).trim() : null,
          city: row.city ? String(row.city).trim() : null,
          ntn: row.ntn ? String(row.ntn).trim() : null,
          strn: row.strn ? String(row.strn).trim() : null,
          drugLicenseNo: row.drugLicenseNo ? String(row.drugLicenseNo).trim() : null,
          creditDays,
          creditLimit,
          isActive: row.isActive === undefined || row.isActive === null ? true : String(row.isActive).toLowerCase() !== 'false',
        });
      }

      previewRows.push({
        ...row,
        _row: rowNum,
        _valid: isValid,
        ...(rowErrors.length > 0 && { _errors: rowErrors }),
      });
    }

    const validRows = previewRows.filter((r) => r._valid).length;
    const invalidRows = previewRows.length - validRows;

    return {
      totalRows: rows.length,
      validRows,
      invalidRows,
      errors,
      warnings,
      summary: {
        totalSuppliers: rows.length,
        validSuppliers: validRows,
        invalidSuppliers: invalidRows,
      },
      previewRows,
      parsedRows: validParsedRows,
    };
  }

  // =========================================================================
  // 4. OPENING STOCK VALIDATION
  // =========================================================================
  private async validateOpeningStock(
    organizationId: string,
    rows: Array<Record<string, unknown>>,
    defaultBranchId?: string,
  ): Promise<ImportValidationResult> {
    const errors: ImportRowError[] = [];
    const warnings: ImportRowWarning[] = [];
    const previewRows: Array<Record<string, unknown> & { _row: number; _valid: boolean; _errors?: string[] }> = [];

    // Pre-fetch products, warehouses, and existing batches
    const [products, warehouses, existingBatches] = await Promise.all([
      this.prisma.product.findMany({
        where: { organizationId },
        select: { id: true, sku: true, name: true },
      }),
      this.prisma.warehouse.findMany({
        where: { organizationId, isActive: true },
        include: { branch: true },
      }),
      this.prisma.batch.findMany({
        where: { product: { organizationId } },
        select: {
          id: true,
          productId: true,
          batchNumber: true,
          mfgDate: true,
          expiryDate: true,
          purchaseCost: true,
          tradePrice: true,
          retailPrice: true,
        },
      }),
    ]);

    const productMap = new Map<string, { id: string; sku: string; name: string }>();
    products.forEach((p) => {
      productMap.set(p.sku.toUpperCase().trim(), p);
    });

    const whMap = new Map<string, { id: string; code: string; name: string; branchId: string }>();
    warehouses.forEach((w) => {
      whMap.set(w.code.toUpperCase().trim(), {
        id: w.id,
        code: w.code,
        name: w.name,
        branchId: w.branchId,
      });
      whMap.set(w.name.toLowerCase().trim(), {
        id: w.id,
        code: w.code,
        name: w.name,
        branchId: w.branchId,
      });
      whMap.set(w.id, {
        id: w.id,
        code: w.code,
        name: w.name,
        branchId: w.branchId,
      });
    });

    // Key: productId_batchNumberUpper -> Batch
    const batchMap = new Map<string, typeof existingBatches[0]>();
    existingBatches.forEach((b) => {
      batchMap.set(`${b.productId}_${b.batchNumber.toUpperCase().trim()}`, b);
    });

    let totalQuantityCount = 0;
    let totalStockValuation = 0;
    const validParsedRows: Array<Record<string, unknown>> = [];

    for (let i = 0; i < rows.length; i++) {
      const rowNum = i + 1;
      const row = rows[i];
      const rowErrors: string[] = [];

      const rawSku = (row.productSku || row.sku) ? String(row.productSku || row.sku).trim() : '';
      const rawBatchNo = row.batchNumber ? String(row.batchNumber).trim() : '';
      const rawExpiry = row.expiryDate ? String(row.expiryDate).trim() : '';
      const rawWarehouse = row.warehouseCode ? String(row.warehouseCode).trim() : '';

      // 1. Mandatory Fields
      if (!rawSku) {
        const msg = 'Product SKU is required.';
        errors.push({ row: rowNum, field: 'productSku', code: 'MISSING_REQUIRED_FIELD', message: msg });
        rowErrors.push(msg);
      }
      if (!rawBatchNo) {
        const msg = 'Batch number is required.';
        errors.push({ row: rowNum, field: 'batchNumber', code: 'MISSING_REQUIRED_FIELD', message: msg });
        rowErrors.push(msg);
      }
      if (!rawExpiry) {
        const msg = 'Expiry date is required.';
        errors.push({ row: rowNum, field: 'expiryDate', code: 'MISSING_REQUIRED_FIELD', message: msg });
        rowErrors.push(msg);
      }
      if (!rawWarehouse) {
        const msg = 'Warehouse is required.';
        errors.push({ row: rowNum, field: 'warehouseCode', code: 'MISSING_REQUIRED_FIELD', message: msg });
        rowErrors.push(msg);
      }

      // 2. Product Resolution
      const product = rawSku ? productMap.get(rawSku.toUpperCase()) : null;
      if (rawSku && !product) {
        const msg = `Product SKU "${rawSku}" could not be found in this organization.`;
        errors.push({ row: rowNum, field: 'productSku', code: 'UNKNOWN_PRODUCT', message: msg, value: rawSku });
        rowErrors.push(msg);
      }

      // 3. Warehouse Resolution
      const warehouse = rawWarehouse ? whMap.get(rawWarehouse.toUpperCase()) || whMap.get(rawWarehouse.toLowerCase()) : null;
      if (rawWarehouse && !warehouse) {
        const msg = `Warehouse "${rawWarehouse}" not found or inactive.`;
        errors.push({ row: rowNum, field: 'warehouseCode', code: 'UNKNOWN_WAREHOUSE', message: msg, value: rawWarehouse });
        rowErrors.push(msg);
      }

      // 4. Quantity validation
      const qty = Number(row.quantity);
      if (row.quantity === undefined || row.quantity === null || isNaN(qty) || qty <= 0 || !Number.isInteger(qty)) {
        const msg = `Quantity must be a strictly positive integer (> 0). Received "${row.quantity}".`;
        errors.push({ row: rowNum, field: 'quantity', code: 'INVALID_QUANTITY', message: msg, value: row.quantity });
        rowErrors.push(msg);
      }

      // 5. Purchase Cost validation
      const cost = Number(row.purchaseCost);
      if (row.purchaseCost === undefined || row.purchaseCost === null || isNaN(cost) || cost <= 0) {
        const msg = `Purchase cost must be a positive number (> 0). Received "${row.purchaseCost}".`;
        errors.push({ row: rowNum, field: 'purchaseCost', code: 'INVALID_PURCHASE_COST', message: msg, value: row.purchaseCost });
        rowErrors.push(msg);
      }

      // Trade & Retail Price
      let tp = cost;
      if (row.tradePrice !== undefined && row.tradePrice !== null && String(row.tradePrice).trim() !== '') {
        tp = Number(row.tradePrice);
        if (isNaN(tp) || tp < 0) {
          const msg = `Trade price must be a non-negative number. Received "${row.tradePrice}".`;
          errors.push({ row: rowNum, field: 'tradePrice', code: 'INVALID_PRICE', message: msg, value: row.tradePrice });
          rowErrors.push(msg);
        }
      }

      let mrp = tp;
      if (row.retailPrice !== undefined && row.retailPrice !== null && String(row.retailPrice).trim() !== '') {
        mrp = Number(row.retailPrice);
        if (isNaN(mrp) || mrp < 0) {
          const msg = `Retail price (MRP) must be a non-negative number. Received "${row.retailPrice}".`;
          errors.push({ row: rowNum, field: 'retailPrice', code: 'INVALID_PRICE', message: msg, value: row.retailPrice });
          rowErrors.push(msg);
        }
      }

      // 6. Dates Validation
      let parsedExpiryDate: Date | null = null;
      if (rawExpiry) {
        parsedExpiryDate = new Date(rawExpiry);
        if (isNaN(parsedExpiryDate.getTime())) {
          const msg = `Invalid expiry date format "${rawExpiry}". Use YYYY-MM-DD.`;
          errors.push({ row: rowNum, field: 'expiryDate', code: 'INVALID_DATE', message: msg, value: rawExpiry });
          rowErrors.push(msg);
        }
      }

      let parsedMfgDate: Date | null = null;
      if (row.mfgDate && String(row.mfgDate).trim() !== '') {
        parsedMfgDate = new Date(String(row.mfgDate).trim());
        if (isNaN(parsedMfgDate.getTime())) {
          const msg = `Invalid manufacturing date format "${row.mfgDate}". Use YYYY-MM-DD.`;
          errors.push({ row: rowNum, field: 'mfgDate', code: 'INVALID_DATE', message: msg, value: row.mfgDate });
          rowErrors.push(msg);
        } else if (parsedExpiryDate && parsedMfgDate > parsedExpiryDate) {
          const msg = `Manufacturing date (${row.mfgDate}) cannot be after expiry date (${rawExpiry}).`;
          errors.push({ row: rowNum, field: 'mfgDate', code: 'INVALID_DATE_SEQUENCE', message: msg, value: row.mfgDate });
          rowErrors.push(msg);
        }
      }

      // 7. Existing Batch Conflict Check (Rule #6)
      let existingBatchId: string | null = null;
      if (product && rawBatchNo) {
        const batchKey = `${product.id}_${rawBatchNo.toUpperCase()}`;
        const existingBatch = batchMap.get(batchKey);
        if (existingBatch) {
          existingBatchId = existingBatch.id;
          // Check for conflicting attributes
          const dbExpiryStr = existingBatch.expiryDate.toISOString().slice(0, 10);
          const fileExpiryStr = parsedExpiryDate ? parsedExpiryDate.toISOString().slice(0, 10) : '';

          if (fileExpiryStr && dbExpiryStr !== fileExpiryStr) {
            const msg = `Existing batch "${rawBatchNo}" has conflicting expiry date (${dbExpiryStr} vs imported ${fileExpiryStr}). Conflicting batch data cannot be overwritten.`;
            errors.push({ row: rowNum, field: 'batchNumber', code: 'BATCH_CONFLICT', message: msg, value: rawBatchNo });
            rowErrors.push(msg);
          }
        }
      }

      const isValid = rowErrors.length === 0;

      if (isValid && product && warehouse && parsedExpiryDate) {
        totalQuantityCount += qty;
        totalStockValuation += qty * cost;

        validParsedRows.push({
          productId: product.id,
          productSku: product.sku,
          productName: product.name,
          warehouseId: warehouse.id,
          warehouseCode: warehouse.code,
          branchId: warehouse.branchId,
          batchNumber: rawBatchNo.trim(),
          existingBatchId,
          mfgDate: parsedMfgDate ? parsedMfgDate.toISOString() : null,
          expiryDate: parsedExpiryDate.toISOString(),
          quantity: qty,
          purchaseCost: cost,
          tradePrice: tp,
          retailPrice: mrp,
        });
      }

      previewRows.push({
        ...row,
        _row: rowNum,
        _valid: isValid,
        ...(rowErrors.length > 0 && { _errors: rowErrors }),
      });
    }

    const validRows = previewRows.filter((r) => r._valid).length;
    const invalidRows = previewRows.length - validRows;

    return {
      totalRows: rows.length,
      validRows,
      invalidRows,
      errors,
      warnings,
      summary: {
        totalRows: rows.length,
        validRows,
        invalidRows,
        totalQuantity: totalQuantityCount,
        totalValuation: Number(totalStockValuation.toFixed(2)),
      },
      previewRows,
      parsedRows: validParsedRows,
    };
  }

  // =========================================================================
  // 5. CUSTOMER OPENING BALANCES VALIDATION
  // =========================================================================
  private async validateCustomerOpeningBalances(
    organizationId: string,
    rows: Array<Record<string, unknown>>,
    defaultBranchId?: string,
  ): Promise<ImportValidationResult> {
    const errors: ImportRowError[] = [];
    const warnings: ImportRowWarning[] = [];
    const previewRows: Array<Record<string, unknown> & { _row: number; _valid: boolean; _errors?: string[] }> = [];

    const [customers, branches] = await Promise.all([
      this.prisma.customer.findMany({
        where: { organizationId },
        select: { id: true, code: true, name: true, currentBalance: true },
      }),
      this.prisma.branch.findMany({
        where: { organizationId, isActive: true },
        select: { id: true, code: true, name: true, isHeadOffice: true },
      }),
    ]);

    const customerMap = new Map<string, typeof customers[0]>();
    customers.forEach((c) => {
      customerMap.set(c.code.toUpperCase().trim(), c);
    });

    const branchMap = new Map<string, string>();
    branches.forEach((b) => {
      branchMap.set(b.code.toUpperCase().trim(), b.id);
      branchMap.set(b.id, b.id);
    });

    const fallbackBranchId = defaultBranchId || branches.find((b) => b.isHeadOffice)?.id || branches[0]?.id;

    const seenCustomersInFile = new Set<string>();
    let totalOpeningReceivable = 0;
    const validParsedRows: Array<Record<string, unknown>> = [];

    for (let i = 0; i < rows.length; i++) {
      const rowNum = i + 1;
      const row = rows[i];
      const rowErrors: string[] = [];

      const rawCode = (row.customerCode || row.code) ? String(row.customerCode || row.code).trim() : '';

      if (!rawCode) {
        const msg = 'Customer Code is required.';
        errors.push({ row: rowNum, field: 'customerCode', code: 'MISSING_REQUIRED_FIELD', message: msg });
        rowErrors.push(msg);
      }

      const upperCode = rawCode.toUpperCase();
      if (rawCode) {
        if (seenCustomersInFile.has(upperCode)) {
          const msg = `Duplicate entry for Customer "${rawCode}" in file. Each customer should have one opening balance.`;
          errors.push({ row: rowNum, field: 'customerCode', code: 'DUPLICATE_ENTRY_IN_FILE', message: msg, value: rawCode });
          rowErrors.push(msg);
        } else {
          seenCustomersInFile.add(upperCode);
        }
      }

      const customer = rawCode ? customerMap.get(upperCode) : null;
      if (rawCode && !customer) {
        const msg = `Customer code "${rawCode}" not found in this organization.`;
        errors.push({ row: rowNum, field: 'customerCode', code: 'UNKNOWN_CUSTOMER', message: msg, value: rawCode });
        rowErrors.push(msg);
      }

      // Amount validation (positive = customer owes us)
      const amt = Number(row.amount);
      if (row.amount === undefined || row.amount === null || isNaN(amt) || amt < 0) {
        const msg = `Opening balance amount must be a non-negative number (>= 0). Received "${row.amount}".`;
        errors.push({ row: rowNum, field: 'amount', code: 'INVALID_AMOUNT', message: msg, value: row.amount });
        rowErrors.push(msg);
      }

      // Branch resolution
      let branchId = fallbackBranchId;
      if (row.branchCode && String(row.branchCode).trim() !== '') {
        const bCode = String(row.branchCode).toUpperCase().trim();
        const resolved = branchMap.get(bCode);
        if (!resolved) {
          const msg = `Branch "${row.branchCode}" could not be resolved.`;
          errors.push({ row: rowNum, field: 'branchCode', code: 'UNKNOWN_BRANCH', message: msg, value: row.branchCode });
          rowErrors.push(msg);
        } else {
          branchId = resolved;
        }
      }

      const isValid = rowErrors.length === 0;

      if (isValid && customer && branchId) {
        totalOpeningReceivable += amt;
        validParsedRows.push({
          customerId: customer.id,
          customerCode: customer.code,
          customerName: customer.name,
          currentBalance: Number(customer.currentBalance),
          branchId,
          amount: amt,
          notes: row.notes ? String(row.notes).trim() : 'Customer opening balance imported',
        });
      }

      previewRows.push({
        ...row,
        _row: rowNum,
        _valid: isValid,
        ...(rowErrors.length > 0 && { _errors: rowErrors }),
      });
    }

    const validRows = previewRows.filter((r) => r._valid).length;
    const invalidRows = previewRows.length - validRows;

    return {
      totalRows: rows.length,
      validRows,
      invalidRows,
      errors,
      warnings,
      summary: {
        totalRows: rows.length,
        validRows,
        invalidRows,
        totalOpeningReceivable: Number(totalOpeningReceivable.toFixed(2)),
      },
      previewRows,
      parsedRows: validParsedRows,
    };
  }

  // =========================================================================
  // 6. SUPPLIER OPENING BALANCES VALIDATION
  // =========================================================================
  private async validateSupplierOpeningBalances(
    organizationId: string,
    rows: Array<Record<string, unknown>>,
    defaultBranchId?: string,
  ): Promise<ImportValidationResult> {
    const errors: ImportRowError[] = [];
    const warnings: ImportRowWarning[] = [];
    const previewRows: Array<Record<string, unknown> & { _row: number; _valid: boolean; _errors?: string[] }> = [];

    const [suppliers, branches] = await Promise.all([
      this.prisma.supplier.findMany({
        where: { organizationId },
        select: { id: true, code: true, name: true, currentBalance: true },
      }),
      this.prisma.branch.findMany({
        where: { organizationId, isActive: true },
        select: { id: true, code: true, name: true, isHeadOffice: true },
      }),
    ]);

    const supplierMap = new Map<string, typeof suppliers[0]>();
    suppliers.forEach((s) => {
      supplierMap.set(s.code.toUpperCase().trim(), s);
    });

    const branchMap = new Map<string, string>();
    branches.forEach((b) => {
      branchMap.set(b.code.toUpperCase().trim(), b.id);
      branchMap.set(b.id, b.id);
    });

    const fallbackBranchId = defaultBranchId || branches.find((b) => b.isHeadOffice)?.id || branches[0]?.id;

    const seenSuppliersInFile = new Set<string>();
    let totalOpeningPayable = 0;
    const validParsedRows: Array<Record<string, unknown>> = [];

    for (let i = 0; i < rows.length; i++) {
      const rowNum = i + 1;
      const row = rows[i];
      const rowErrors: string[] = [];

      const rawCode = (row.supplierCode || row.code) ? String(row.supplierCode || row.code).trim() : '';

      if (!rawCode) {
        const msg = 'Supplier Code is required.';
        errors.push({ row: rowNum, field: 'supplierCode', code: 'MISSING_REQUIRED_FIELD', message: msg });
        rowErrors.push(msg);
      }

      const upperCode = rawCode.toUpperCase();
      if (rawCode) {
        if (seenSuppliersInFile.has(upperCode)) {
          const msg = `Duplicate entry for Supplier "${rawCode}" in file.`;
          errors.push({ row: rowNum, field: 'supplierCode', code: 'DUPLICATE_ENTRY_IN_FILE', message: msg, value: rawCode });
          rowErrors.push(msg);
        } else {
          seenSuppliersInFile.add(upperCode);
        }
      }

      const supplier = rawCode ? supplierMap.get(upperCode) : null;
      if (rawCode && !supplier) {
        const msg = `Supplier code "${rawCode}" not found in this organization.`;
        errors.push({ row: rowNum, field: 'supplierCode', code: 'UNKNOWN_SUPPLIER', message: msg, value: rawCode });
        rowErrors.push(msg);
      }

      // Amount validation (positive = we owe supplier)
      const amt = Number(row.amount);
      if (row.amount === undefined || row.amount === null || isNaN(amt) || amt < 0) {
        const msg = `Opening balance amount must be a non-negative number (>= 0). Received "${row.amount}".`;
        errors.push({ row: rowNum, field: 'amount', code: 'INVALID_AMOUNT', message: msg, value: row.amount });
        rowErrors.push(msg);
      }

      // Branch resolution
      let branchId = fallbackBranchId;
      if (row.branchCode && String(row.branchCode).trim() !== '') {
        const bCode = String(row.branchCode).toUpperCase().trim();
        const resolved = branchMap.get(bCode);
        if (!resolved) {
          const msg = `Branch "${row.branchCode}" could not be resolved.`;
          errors.push({ row: rowNum, field: 'branchCode', code: 'UNKNOWN_BRANCH', message: msg, value: row.branchCode });
          rowErrors.push(msg);
        } else {
          branchId = resolved;
        }
      }

      const isValid = rowErrors.length === 0;

      if (isValid && supplier && branchId) {
        totalOpeningPayable += amt;
        validParsedRows.push({
          supplierId: supplier.id,
          supplierCode: supplier.code,
          supplierName: supplier.name,
          currentBalance: Number(supplier.currentBalance),
          branchId,
          amount: amt,
          notes: row.notes ? String(row.notes).trim() : 'Supplier opening balance imported',
        });
      }

      previewRows.push({
        ...row,
        _row: rowNum,
        _valid: isValid,
        ...(rowErrors.length > 0 && { _errors: rowErrors }),
      });
    }

    const validRows = previewRows.filter((r) => r._valid).length;
    const invalidRows = previewRows.length - validRows;

    return {
      totalRows: rows.length,
      validRows,
      invalidRows,
      errors,
      warnings,
      summary: {
        totalRows: rows.length,
        validRows,
        invalidRows,
        totalOpeningPayable: Number(totalOpeningPayable.toFixed(2)),
      },
      previewRows,
      parsedRows: validParsedRows,
    };
  }
}
