import { Injectable, BadRequestException } from '@nestjs/common';
import * as XLSX from 'xlsx';
import { ImportType } from '@prisma/client';

export interface ParsedSheetResult {
  headers: string[];
  rows: Array<Record<string, unknown>>;
  totalRows: number;
}

@Injectable()
export class ImportParserService {
  private readonly MAX_ROWS = 10000;

  /**
   * Parses CSV or XLSX buffer safely into structured JavaScript objects.
   */
  parseBuffer(buffer: Buffer, originalFilename: string): ParsedSheetResult {
    if (!buffer || buffer.length === 0) {
      throw new BadRequestException('Uploaded file is empty.');
    }

    let workbook: XLSX.WorkBook;
    try {
      workbook = XLSX.read(buffer, {
        type: 'buffer',
        cellDates: true,
        raw: false,
        dateNF: 'yyyy-mm-dd',
      });
    } catch (error) {
      throw new BadRequestException(
        `Failed to parse spreadsheet file "${originalFilename}": ${(error as Error).message}`,
      );
    }

    if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
      throw new BadRequestException('Spreadsheet contains no worksheets.');
    }

    const firstSheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[firstSheetName];

    if (!worksheet || !worksheet['!ref']) {
      return { headers: [], rows: [], totalRows: 0 };
    }

    // Convert sheet to JSON array of row objects
    const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, {
      defval: null,
      raw: false,
      blankrows: false,
    });

    if (rawRows.length > this.MAX_ROWS) {
      throw new BadRequestException(
        `Import exceeds maximum allowed row count (${this.MAX_ROWS} rows). Found ${rawRows.length} rows.`,
      );
    }

    // Extract and normalize headers
    const rawHeaders: string[] = [];
    if (rawRows.length > 0) {
      Object.keys(rawRows[0]).forEach((h) => {
        if (!h.startsWith('__EMPTY')) {
          rawHeaders.push(h);
        }
      });
    }

    // Normalize each row keys
    const normalizedRows = rawRows
      .filter((row) => this.isNonEmptyRow(row))
      .map((row) => this.normalizeRowKeys(row));

    return {
      headers: rawHeaders,
      rows: normalizedRows,
      totalRows: normalizedRows.length,
    };
  }

  /**
   * Normalizes header key strings to camelCase canonical field identifiers.
   */
  private normalizeKey(key: string): string {
    const clean = key
      .toLowerCase()
      .trim()
      .replace(/[\s\-_]+/g, '');

    const ALIAS_MAP: Record<string, string> = {
      // Products
      sku: 'sku',
      itemcode: 'sku',
      productcode: 'sku',
      productsku: 'sku',
      name: 'name',
      productname: 'name',
      brandname: 'name',
      itemname: 'name',
      genericname: 'genericName',
      generic: 'genericName',
      formula: 'genericName',
      manufacturer: 'manufacturer',
      manufacturername: 'manufacturer',
      company: 'manufacturer',
      principal: 'manufacturer',
      category: 'category',
      categoryname: 'category',
      productcategory: 'category',
      unit: 'unit',
      uom: 'unit',
      unitsymbol: 'unit',
      unitname: 'unit',
      dosageform: 'dosageForm',
      form: 'dosageForm',
      strength: 'strength',
      potency: 'strength',
      packsize: 'packSize',
      packaging: 'packSize',
      barcode: 'barcode',
      upc: 'barcode',
      taxpercentage: 'taxPercentage',
      tax: 'taxPercentage',
      taxpercent: 'taxPercentage',
      description: 'description',
      isactive: 'isActive',
      active: 'isActive',
      status: 'isActive',

      // Customers
      code: 'code',
      customercode: 'code',
      partycode: 'code',
      accountcode: 'code',
      customername: 'name',
      partyname: 'name',
      customertype: 'customerType',
      type: 'customerType',
      contactperson: 'contactPerson',
      contact: 'contactPerson',
      phone: 'phone',
      mobile: 'phone',
      telephone: 'phone',
      email: 'email',
      address: 'address',
      streetaddress: 'address',
      city: 'city',
      ntn: 'ntn',
      strn: 'strn',
      drugsalelicense: 'drugSaleLicenseNo',
      drugsalelicenseno: 'drugSaleLicenseNo',
      druglicense: 'drugSaleLicenseNo',
      druglicenseno: 'drugSaleLicenseNo',
      dsl: 'drugSaleLicenseNo',
      creditdays: 'creditDays',
      creditlimit: 'creditLimit',
      defaultdiscountpercentage: 'defaultDiscountPercentage',
      defaultdiscount: 'defaultDiscountPercentage',
      discount: 'defaultDiscountPercentage',
      istaxexempt: 'isTaxExempt',
      taxexempt: 'isTaxExempt',

      // Suppliers
      suppliercode: 'code',
      vendorcode: 'code',
      suppliername: 'name',
      vendorname: 'name',

      // Opening stock & Batches
      batchnumber: 'batchNumber',
      batchno: 'batchNumber',
      batch: 'batchNumber',
      lotnumber: 'batchNumber',
      lot: 'batchNumber',
      mfgdate: 'mfgDate',
      manufacturingdate: 'mfgDate',
      expirydate: 'expiryDate',
      expiry: 'expiryDate',
      expdate: 'expiryDate',
      quantity: 'quantity',
      qty: 'quantity',
      openingqty: 'quantity',
      purchasecost: 'purchaseCost',
      costprice: 'purchaseCost',
      cost: 'purchaseCost',
      tradeprice: 'tradePrice',
      tp: 'tradePrice',
      retailprice: 'retailPrice',
      mrp: 'retailPrice',
      maxretailprice: 'retailPrice',
      warehousecode: 'warehouseCode',
      warehouse: 'warehouseCode',
      warehousename: 'warehouseCode',
      whcode: 'warehouseCode',

      // Balances
      amount: 'amount',
      openingbalance: 'amount',
      balance: 'amount',
      receivable: 'amount',
      payable: 'amount',
      notes: 'notes',
      remarks: 'notes',
      branchcode: 'branchCode',
      branch: 'branchCode',
    };

    return ALIAS_MAP[clean] || clean;
  }

  private normalizeRowKeys(row: Record<string, unknown>): Record<string, unknown> {
    const normalized: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row)) {
      if (key.startsWith('__EMPTY')) continue;
      const normKey = this.normalizeKey(key);
      let sanitizedValue = value;
      if (typeof sanitizedValue === 'string') {
        sanitizedValue = sanitizedValue.trim();
        if (sanitizedValue === '') sanitizedValue = null;
      }
      normalized[normKey] = sanitizedValue;
    }
    return normalized;
  }

  private isNonEmptyRow(row: Record<string, unknown>): boolean {
    return Object.values(row).some(
      (val) => val !== null && val !== undefined && String(val).trim().length > 0,
    );
  }

  /**
   * Generates sample template data for each import type.
   */
  getTemplateDefinitions(type: ImportType): {
    headers: string[];
    sampleRows: Array<Record<string, string | number>>;
    filename: string;
  } {
    switch (type) {
      case ImportType.PRODUCTS:
        return {
          filename: 'medix_products_template.csv',
          headers: [
            'SKU',
            'Name',
            'GenericName',
            'Manufacturer',
            'Category',
            'Unit',
            'DosageForm',
            'Strength',
            'PackSize',
            'Barcode',
            'TaxPercentage',
            'Description',
            'IsActive',
          ],
          sampleRows: [
            {
              SKU: 'MED-PAN-500',
              Name: 'Panadol 500mg Tablets',
              GenericName: 'Paracetamol',
              Manufacturer: 'GSK Pakistan',
              Category: 'Analgesics & Antipyretics',
              Unit: 'Box',
              DosageForm: 'Tablet',
              Strength: '500mg',
              PackSize: '20x10',
              Barcode: '896400012345',
              TaxPercentage: 0,
              Description: 'Standard paracetamol analgesics',
              IsActive: 'true',
            },
            {
              SKU: 'MED-AUG-625',
              Name: 'Augmentin 625mg Tablets',
              GenericName: 'Amoxicillin + Clavulanic Acid',
              Manufacturer: 'GSK Pakistan',
              Category: 'Antibiotics',
              Unit: 'Box',
              DosageForm: 'Tablet',
              Strength: '625mg',
              PackSize: '2x7',
              Barcode: '896400054321',
              TaxPercentage: 0,
              Description: 'Broad-spectrum antibiotic',
              IsActive: 'true',
            },
          ],
        };

      case ImportType.CUSTOMERS:
        return {
          filename: 'medix_customers_template.csv',
          headers: [
            'Code',
            'Name',
            'CustomerType',
            'ContactPerson',
            'Phone',
            'Email',
            'Address',
            'City',
            'NTN',
            'STRN',
            'DrugSaleLicenseNo',
            'CreditDays',
            'CreditLimit',
            'DefaultDiscountPercentage',
            'IsTaxExempt',
            'IsActive',
          ],
          sampleRows: [
            {
              Code: 'CUST-00101',
              Name: 'Al-Shifa Pharmacy',
              CustomerType: 'RETAIL_PHARMACY',
              ContactPerson: 'Dr. Tariq Mehmood',
              Phone: '0300-1234567',
              Email: 'alshifa@example.com',
              Address: 'Shop # 12, Main Commercial Market',
              City: 'Karachi',
              NTN: '1234567-8',
              STRN: '17-00-1234-567-89',
              DrugSaleLicenseNo: 'DSL-KHI-2026-101',
              CreditDays: 15,
              CreditLimit: 250000,
              DefaultDiscountPercentage: 2.5,
              IsTaxExempt: 'false',
              IsActive: 'true',
            },
            {
              Code: 'CUST-00102',
              Name: 'Civil Hospital Lahore',
              CustomerType: 'HOSPITAL',
              ContactPerson: 'Procurement Officer',
              Phone: '042-37890123',
              Email: 'procurement@civilhospital.pk',
              Address: 'Hospital Road, Lahore',
              City: 'Lahore',
              NTN: '7654321-0',
              STRN: '17-00-7654-321-00',
              DrugSaleLicenseNo: 'DSL-LHR-2026-202',
              CreditDays: 30,
              CreditLimit: 1000000,
              DefaultDiscountPercentage: 5.0,
              IsTaxExempt: 'true',
              IsActive: 'true',
            },
          ],
        };

      case ImportType.SUPPLIERS:
        return {
          filename: 'medix_suppliers_template.csv',
          headers: [
            'Code',
            'Name',
            'ContactPerson',
            'Phone',
            'Email',
            'Address',
            'City',
            'NTN',
            'STRN',
            'DrugLicenseNo',
            'CreditDays',
            'CreditLimit',
            'IsActive',
          ],
          sampleRows: [
            {
              Code: 'SUP-001',
              Name: 'Getz Pharma Distribution',
              ContactPerson: 'Supply Chain Manager',
              Phone: '021-35001122',
              Email: 'orders@getzpharma.com',
              Address: 'Plot # 29-30, Sector 27, Korangi Industrial Area',
              City: 'Karachi',
              NTN: '3100123-4',
              STRN: '17-00-3100-123-11',
              DrugLicenseNo: 'ML-0021-KHI',
              CreditDays: 30,
              CreditLimit: 5000000,
              IsActive: 'true',
            },
            {
              Code: 'SUP-002',
              Name: 'Searle Company Limited',
              ContactPerson: 'Distributor Coordinator',
              Phone: '021-35002233',
              Email: 'distributors@searle.pk',
              Address: 'F-224, S.I.T.E. Area',
              City: 'Karachi',
              NTN: '2100987-6',
              STRN: '17-00-2100-987-22',
              DrugLicenseNo: 'ML-0045-KHI',
              CreditDays: 45,
              CreditLimit: 8000000,
              IsActive: 'true',
            },
          ],
        };

      case ImportType.OPENING_STOCK:
        return {
          filename: 'medix_opening_stock_template.csv',
          headers: [
            'ProductSKU',
            'BatchNumber',
            'MfgDate',
            'ExpiryDate',
            'Quantity',
            'PurchaseCost',
            'TradePrice',
            'RetailPrice',
            'WarehouseCode',
          ],
          sampleRows: [
            {
              ProductSKU: 'MED-PAN-500',
              BatchNumber: 'BN-2026-01',
              MfgDate: '2026-01-15',
              ExpiryDate: '2028-01-15',
              Quantity: 500,
              PurchaseCost: 38.5,
              TradePrice: 45.0,
              RetailPrice: 50.0,
              WarehouseCode: 'WH-MAIN',
            },
            {
              ProductSKU: 'MED-AUG-625',
              BatchNumber: 'BN-AUG-88',
              MfgDate: '2026-02-01',
              ExpiryDate: '2027-08-01',
              Quantity: 200,
              PurchaseCost: 190.0,
              TradePrice: 220.0,
              RetailPrice: 250.0,
              WarehouseCode: 'WH-MAIN',
            },
          ],
        };

      case ImportType.CUSTOMER_OPENING_BALANCES:
        return {
          filename: 'medix_customer_opening_balances_template.csv',
          headers: ['CustomerCode', 'Amount', 'Notes', 'BranchCode'],
          sampleRows: [
            {
              CustomerCode: 'CUST-00101',
              Amount: 145000.5,
              Notes: 'Migrated opening receivable from legacy system',
              BranchCode: 'HO',
            },
            {
              CustomerCode: 'CUST-00102',
              Amount: 480000.0,
              Notes: 'Previous fiscal outstanding billing',
              BranchCode: 'HO',
            },
          ],
        };

      case ImportType.SUPPLIER_OPENING_BALANCES:
        return {
          filename: 'medix_supplier_opening_balances_template.csv',
          headers: ['SupplierCode', 'Amount', 'Notes', 'BranchCode'],
          sampleRows: [
            {
              SupplierCode: 'SUP-001',
              Amount: 850000.0,
              Notes: 'Opening payable outstanding for Getz Pharma',
              BranchCode: 'HO',
            },
            {
              SupplierCode: 'SUP-002',
              Amount: 1200000.0,
              Notes: 'Opening payable balance from previous year ledger',
              BranchCode: 'HO',
            },
          ],
        };

      default:
        throw new BadRequestException(`Unsupported import type: ${type}`);
    }
  }

  /**
   * Generates a CSV Buffer for a template.
   */
  generateCsvTemplate(type: ImportType): { buffer: Buffer; filename: string } {
    const def = this.getTemplateDefinitions(type);
    const worksheet = XLSX.utils.json_to_sheet(def.sampleRows, {
      header: def.headers,
    });
    const csvString = XLSX.utils.sheet_to_csv(worksheet);
    return {
      buffer: Buffer.from(csvString, 'utf-8'),
      filename: def.filename,
    };
  }
}
