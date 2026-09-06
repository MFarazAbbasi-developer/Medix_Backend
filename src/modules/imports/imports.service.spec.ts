import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ImportsService } from './imports.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ImportParserService } from './services/import-parser.service';
import { ImportValidatorService } from './services/import-validator.service';
import { ImportExecutorService } from './services/import-executor.service';
import { ImportType, ImportJobStatus } from '@prisma/client';

describe('ImportsService', () => {
  let service: ImportsService;
  let mockPrisma: any;
  let mockAudit: any;
  let mockParser: any;
  let mockValidator: any;
  let mockExecutor: any;

  beforeEach(() => {
    mockAudit = {
      log: vi.fn().mockResolvedValue(undefined),
    };

    mockPrisma = {
      organization: {
        findFirst: vi.fn().mockResolvedValue({ id: 'org-1', name: 'Medix Pharma' }),
      },
      branch: {
        findFirst: vi.fn().mockResolvedValue({ id: 'br-1', name: 'Head Office', code: 'HO' }),
      },
      importJob: {
        create: vi.fn().mockResolvedValue({
          id: 'job-1',
          type: ImportType.PRODUCTS,
          status: ImportJobStatus.READY,
          originalFilename: 'products.csv',
          totalRows: 2,
          validRows: 2,
          invalidRows: 0,
          createdAt: new Date(),
        }),
        findMany: vi.fn().mockResolvedValue([]),
        count: vi.fn().mockResolvedValue(0),
        findFirst: vi.fn(),
        update: vi.fn(),
      },
    };

    mockParser = {
      parseBuffer: vi.fn().mockReturnValue({
        headers: ['SKU', 'Name', 'GenericName'],
        rows: [
          { sku: 'MED-001', name: 'Panadol', genericName: 'Paracetamol' },
          { sku: 'MED-002', name: 'Augmentin', genericName: 'Amoxicillin' },
        ],
        totalRows: 2,
      }),
      generateCsvTemplate: vi.fn().mockReturnValue({
        buffer: Buffer.from('test template'),
        filename: 'template.csv',
      }),
    };

    mockValidator = {
      validate: vi.fn().mockResolvedValue({
        totalRows: 2,
        validRows: 2,
        invalidRows: 0,
        errors: [],
        warnings: [],
        summary: { totalProducts: 2 },
        previewRows: [],
        parsedRows: [{}, {}],
      }),
    };

    mockExecutor = {
      executeImport: vi.fn().mockResolvedValue({
        id: 'job-1',
        status: ImportJobStatus.COMPLETED,
      }),
    };

    service = new ImportsService(
      mockPrisma as unknown as PrismaService,
      mockAudit as unknown as AuditService,
      mockParser as unknown as ImportParserService,
      mockValidator as unknown as ImportValidatorService,
      mockExecutor as unknown as ImportExecutorService,
    );
  });

  it('should upload and validate an import file', async () => {
    const mockFile: Express.Multer.File = {
      fieldname: 'file',
      originalname: 'products.csv',
      encoding: '7bit',
      mimetype: 'text/csv',
      size: 512,
      buffer: Buffer.from('SKU,Name\nMED-1,Panadol'),
      stream: null as any,
      destination: '',
      filename: '',
      path: '',
    };

    const res = await service.uploadFile(mockFile, { type: ImportType.PRODUCTS }, 'user-1');

    expect(res.job.status).toBe(ImportJobStatus.READY);
    expect(res.preview.validRows).toBe(2);
    expect(mockAudit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'UPLOAD_IMPORT_FILE' }),
    );
  });

  it('should cancel an import job before execution', async () => {
    mockPrisma.importJob.findFirst.mockResolvedValueOnce({
      id: 'job-cancel',
      organizationId: 'org-1',
      status: ImportJobStatus.READY,
      originalFilename: 'test.csv',
      type: ImportType.CUSTOMERS,
    });
    mockPrisma.importJob.update.mockResolvedValueOnce({
      id: 'job-cancel',
      status: ImportJobStatus.CANCELLED,
    });

    const res = await service.cancelImport('job-cancel', 'user-1');
    expect(res.status).toBe(ImportJobStatus.CANCELLED);
  });

  it('should export validation errors as CSV', async () => {
    mockPrisma.importJob.findFirst.mockResolvedValueOnce({
      id: 'job-err',
      organizationId: 'org-1',
      type: ImportType.PRODUCTS,
      metadata: {
        errors: [
          { row: 1, field: 'sku', code: 'DUPLICATE_SKU', message: 'Duplicate SKU found' },
        ],
      },
    });

    const result = await service.exportErrorsCsv('job-err');
    expect(result.filename).toContain('import_errors_products_');
    expect(result.buffer.toString()).toContain('DUPLICATE_SKU');
  });
});
