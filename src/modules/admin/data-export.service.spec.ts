import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DataExportService } from './services/data-export.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('DataExportService', () => {
  let service: DataExportService;
  let prisma: any;

  beforeEach(() => {
    prisma = {
      product: {
        findMany: vi.fn().mockResolvedValue([
          {
            sku: 'MED-001',
            name: 'Panadol 500mg',
            genericName: 'Paracetamol',
            brandName: 'GSK',
            category: { name: 'Analgesics' },
            manufacturer: { name: 'GSK Pakistan' },
            dosageForm: { name: 'Tablet' },
            strength: '500mg',
            barcode: '12345678',
            minStockLevel: 100,
            maxStockLevel: 1000,
            reorderQuantity: 200,
            requiresPrescription: false,
            isNarcotic: false,
            isActive: true,
            createdAt: new Date('2026-01-01'),
          },
        ]),
      },
      customer: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    };

    service = new DataExportService(prisma as unknown as PrismaService);
  });

  describe('exportDataset', () => {
    it('should generate valid RFC 4180 CSV for products without exposing any credentials', async () => {
      const result = await service.exportDataset({ dataset: 'products' });
      expect(result.filename).toMatch(/^medix_export_products_/);
      expect(result.rowCount).toBe(1);
      expect(result.data).toContain('MED-001');
      expect(result.data).toContain('Panadol 500mg');
      expect(result.data).not.toContain('password');
      expect(result.data).not.toContain('hash');
    });
  });
});
