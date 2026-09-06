import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ImportValidatorService } from './import-validator.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { ImportType } from '@prisma/client';

describe('ImportValidatorService', () => {
  let validatorService: ImportValidatorService;
  let mockPrisma: any;

  beforeEach(() => {
    mockPrisma = {
      product: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'p-1', sku: 'MED-PAN-500', name: 'Panadol 500mg' },
        ]),
      },
      manufacturer: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'mfg-1', name: 'GSK Pakistan', code: 'GSK' },
        ]),
      },
      productCategory: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'cat-1', name: 'Analgesics', code: 'ANAL' },
        ]),
      },
      unitOfMeasurement: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'uom-1', name: 'Box', symbol: 'Box' },
        ]),
      },
      customer: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'cust-1', code: 'CUST-001', name: 'Al-Shifa', currentBalance: 5000 },
        ]),
      },
      supplier: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'sup-1', code: 'SUP-001', name: 'Getz Pharma', currentBalance: 12000 },
        ]),
      },
      warehouse: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'wh-1', code: 'WH-MAIN', name: 'Main Warehouse', branchId: 'br-1', isActive: true },
        ]),
      },
      branch: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'br-1', code: 'HO', name: 'Head Office', isHeadOffice: true, isActive: true },
        ]),
      },
      batch: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'b-1',
            productId: 'p-1',
            batchNumber: 'BN-101',
            expiryDate: new Date('2028-01-01'),
            purchaseCost: 40,
            tradePrice: 45,
            retailPrice: 50,
          },
        ]),
      },
    };

    validatorService = new ImportValidatorService(mockPrisma as unknown as PrismaService);
  });

  describe('Products Validation', () => {
    it('should validate valid products correctly', async () => {
      const rows = [
        {
          sku: 'MED-NEW-01',
          name: 'New Medicine 100mg',
          genericName: 'Sample Generic',
          manufacturer: 'GSK Pakistan',
          category: 'Analgesics',
          unit: 'Box',
          taxPercentage: 0,
        },
      ];

      const result = await validatorService.validate(ImportType.PRODUCTS, 'org-1', rows);
      expect(result.validRows).toBe(1);
      expect(result.invalidRows).toBe(0);
      expect(result.errors).toHaveLength(0);
    });

    it('should return error for duplicate SKU in database', async () => {
      const rows = [
        {
          sku: 'MED-PAN-500', // already in DB
          name: 'Panadol duplicate',
          genericName: 'Paracetamol',
        },
      ];

      const result = await validatorService.validate(ImportType.PRODUCTS, 'org-1', rows);
      expect(result.validRows).toBe(0);
      expect(result.invalidRows).toBe(1);
      expect(result.errors[0].code).toBe('DUPLICATE_SKU');
    });

    it('should return error for unknown manufacturer, category, and unit', async () => {
      const rows = [
        {
          sku: 'MED-NEW-02',
          name: 'Medicine Two',
          genericName: 'Sample',
          manufacturer: 'NonExistentMfg',
          category: 'NonExistentCat',
          unit: 'NonExistentUnit',
        },
      ];

      const result = await validatorService.validate(ImportType.PRODUCTS, 'org-1', rows);
      expect(result.invalidRows).toBe(1);
      expect(result.errors.some((e) => e.code === 'UNKNOWN_MANUFACTURER')).toBe(true);
      expect(result.errors.some((e) => e.code === 'UNKNOWN_CATEGORY')).toBe(true);
      expect(result.errors.some((e) => e.code === 'UNKNOWN_UNIT')).toBe(true);
    });
  });

  describe('Customers Validation', () => {
    it('should validate valid customer and reject duplicate code', async () => {
      const rows = [
        { code: 'CUST-NEW', name: 'New Pharmacy', customerType: 'RETAIL_PHARMACY' },
        { code: 'CUST-001', name: 'Al-Shifa Duplicate' }, // in DB
      ];

      const result = await validatorService.validate(ImportType.CUSTOMERS, 'org-1', rows);
      expect(result.validRows).toBe(1);
      expect(result.invalidRows).toBe(1);
      expect(result.errors[0].code).toBe('DUPLICATE_CUSTOMER_CODE');
    });

    it('should reject invalid customer type', async () => {
      const rows = [
        { code: 'CUST-INV', name: 'Invalid Type Customer', customerType: 'SUPERMARKET' },
      ];

      const result = await validatorService.validate(ImportType.CUSTOMERS, 'org-1', rows);
      expect(result.invalidRows).toBe(1);
      expect(result.errors[0].code).toBe('INVALID_CUSTOMER_TYPE');
    });
  });

  describe('Opening Stock Validation', () => {
    it('should validate valid opening stock row', async () => {
      const rows = [
        {
          productSku: 'MED-PAN-500',
          batchNumber: 'BN-NEW-99',
          expiryDate: '2028-05-01',
          quantity: 100,
          purchaseCost: 35.5,
          warehouseCode: 'WH-MAIN',
        },
      ];

      const result = await validatorService.validate(ImportType.OPENING_STOCK, 'org-1', rows);
      expect(result.validRows).toBe(1);
      expect(result.invalidRows).toBe(0);
      expect(result.errors).toHaveLength(0);
    });

    it('should return error for unknown product SKU or warehouse', async () => {
      const rows = [
        {
          productSku: 'UNKNOWN-SKU',
          batchNumber: 'BN-99',
          expiryDate: '2028-05-01',
          quantity: 100,
          purchaseCost: 35.5,
          warehouseCode: 'UNKNOWN-WH',
        },
      ];

      const result = await validatorService.validate(ImportType.OPENING_STOCK, 'org-1', rows);
      expect(result.invalidRows).toBe(1);
      expect(result.errors.some((e) => e.code === 'UNKNOWN_PRODUCT')).toBe(true);
      expect(result.errors.some((e) => e.code === 'UNKNOWN_WAREHOUSE')).toBe(true);
    });

    it('should return error on batch conflict with differing expiry date', async () => {
      const rows = [
        {
          productSku: 'MED-PAN-500',
          batchNumber: 'BN-101', // existing batch has expiry 2028-01-01
          expiryDate: '2029-06-01', // conflicting date!
          quantity: 50,
          purchaseCost: 40,
          warehouseCode: 'WH-MAIN',
        },
      ];

      const result = await validatorService.validate(ImportType.OPENING_STOCK, 'org-1', rows);
      expect(result.invalidRows).toBe(1);
      expect(result.errors.some((e) => e.code === 'BATCH_CONFLICT')).toBe(true);
    });
  });

  describe('Opening Balances Validation', () => {
    it('should validate customer opening balances', async () => {
      const rows = [
        { customerCode: 'CUST-001', amount: 45000, branchCode: 'HO' },
      ];

      const result = await validatorService.validate(ImportType.CUSTOMER_OPENING_BALANCES, 'org-1', rows);
      expect(result.validRows).toBe(1);
      expect(result.invalidRows).toBe(0);
    });

    it('should validate supplier opening balances', async () => {
      const rows = [
        { supplierCode: 'SUP-001', amount: 150000, branchCode: 'HO' },
      ];

      const result = await validatorService.validate(ImportType.SUPPLIER_OPENING_BALANCES, 'org-1', rows);
      expect(result.validRows).toBe(1);
      expect(result.invalidRows).toBe(0);
    });
  });
});
