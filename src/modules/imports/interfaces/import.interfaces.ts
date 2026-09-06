import { ImportType, ImportJobStatus } from '@prisma/client';

export interface ImportRowError {
  row: number;
  field: string;
  code: string;
  message: string;
  value?: unknown;
}

export interface ImportRowWarning {
  row: number;
  field: string;
  code: string;
  message: string;
  value?: unknown;
}

export interface ImportValidationResult<T = Record<string, unknown>> {
  totalRows: number;
  validRows: number;
  invalidRows: number;
  errors: ImportRowError[];
  warnings: ImportRowWarning[];
  summary: Record<string, unknown>;
  previewRows: Array<Record<string, unknown> & { _row: number; _valid: boolean; _errors?: string[] }>;
  parsedRows: T[];
}

export interface ProductImportRow {
  sku: string;
  name: string;
  genericName: string;
  manufacturer?: string;
  category?: string;
  unit?: string;
  dosageForm?: string;
  strength?: string;
  packSize?: string;
  barcode?: string;
  taxPercentage?: number;
  description?: string;
  isActive?: boolean;
}

export interface CustomerImportRow {
  code: string;
  name: string;
  customerType?: string;
  contactPerson?: string;
  phone?: string;
  email?: string;
  address?: string;
  city?: string;
  ntn?: string;
  strn?: string;
  drugSaleLicenseNo?: string;
  creditDays?: number;
  creditLimit?: number;
  defaultDiscountPercentage?: number;
  isTaxExempt?: boolean;
  isActive?: boolean;
}

export interface SupplierImportRow {
  code: string;
  name: string;
  contactPerson?: string;
  phone?: string;
  email?: string;
  address?: string;
  city?: string;
  ntn?: string;
  strn?: string;
  drugLicenseNo?: string;
  creditDays?: number;
  creditLimit?: number;
  isActive?: boolean;
}

export interface OpeningStockImportRow {
  productSku: string;
  batchNumber: string;
  mfgDate?: string;
  expiryDate: string;
  quantity: number;
  purchaseCost: number;
  tradePrice?: number;
  retailPrice?: number;
  warehouseCode: string;
}

export interface CustomerOpeningBalanceRow {
  customerCode: string;
  amount: number;
  notes?: string;
  branchCode?: string;
}

export interface SupplierOpeningBalanceRow {
  supplierCode: string;
  amount: number;
  notes?: string;
  branchCode?: string;
}

export interface ImportJobMetadata {
  originalFilename: string;
  fileSize: number;
  mimeType: string;
  summary: Record<string, unknown>;
  errors: ImportRowError[];
  warnings: ImportRowWarning[];
  previewRows: Array<Record<string, unknown> & { _row: number; _valid: boolean; _errors?: string[] }>;
  parsedPayload?: unknown[];
  failureReason?: string;
}
