import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NumberingService } from './numbering.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { DocumentType } from '@prisma/client';

describe('NumberingService', () => {
  let service: NumberingService;
  let prisma: PrismaService;
  let auditService: AuditService;

  const mockOrg = { id: 'org-uuid-1', name: 'Medix Pharma' };

  const mockSeries = {
    id: 'series-uuid-1',
    organizationId: 'org-uuid-1',
    branchId: null,
    documentType: DocumentType.SALES_INVOICE,
    prefix: 'INV-',
    suffix: null,
    nextNumber: 1,
    padding: 5,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(() => {
    let mockNextNumber = 1;

    prisma = {
      organization: {
        findFirst: vi.fn().mockResolvedValue(mockOrg),
      },
      numberingSeries: {
        findFirst: vi.fn().mockResolvedValue(mockSeries),
        findMany: vi.fn().mockResolvedValue([mockSeries]),
        findUnique: vi.fn().mockResolvedValue(mockSeries),
        update: vi.fn(),
      },
      // Mock atomic UPDATE ... RETURNING query execution
      $queryRaw: vi.fn().mockImplementation(async () => {
        const current = mockNextNumber;
        mockNextNumber += 1;
        return [
          {
            id: 'series-uuid-1',
            prefix: 'INV-',
            suffix: null,
            current_number: current,
            padding: 5,
          },
        ];
      }),
    } as unknown as PrismaService;

    auditService = {
      log: vi.fn().mockResolvedValue(undefined),
    } as unknown as AuditService;

    service = new NumberingService(prisma, auditService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('formatNumber', () => {
    it('should pad numbers with zeros correctly', () => {
      expect(service.formatNumber('INV-', 1, 5)).toBe('INV-00001');
      expect(service.formatNumber('INV-', 245, 5)).toBe('INV-00245');
      expect(service.formatNumber('PINV-', 99, 4, '-KHI')).toBe('PINV-0099-KHI');
    });
  });

  describe('previewNextNumber', () => {
    it('should return the formatted preview without incrementing DB counter', async () => {
      const preview = await service.previewNextNumber(DocumentType.SALES_INVOICE);
      expect(preview.documentNumber).toBe('INV-00001');
      expect(preview.sequence).toBe(1);
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
    });
  });

  describe('generateNextNumber concurrency safety', () => {
    it('should generate strictly unique numbers concurrently using Promise.all', async () => {
      const CONCURRENT_REQUESTS = 25;

      // Simulate 25 concurrent requests from different LAN stations
      const promises = Array.from({ length: CONCURRENT_REQUESTS }, () =>
        service.generateNextNumber(DocumentType.SALES_INVOICE),
      );

      const results = await Promise.all(promises);

      expect(results).toHaveLength(CONCURRENT_REQUESTS);

      const documentNumbers = results.map((r) => r.documentNumber);
      const uniqueNumbers = new Set(documentNumbers);

      // Verify that every single generated number is unique (no collisions)
      expect(uniqueNumbers.size).toBe(CONCURRENT_REQUESTS);

      // Verify sequence starts at 1 and increments consecutively
      const sequences = results.map((r) => r.sequence).sort((a, b) => a - b);
      for (let i = 0; i < CONCURRENT_REQUESTS; i++) {
        expect(sequences[i]).toBe(i + 1);
        expect(documentNumbers).toContain(
          `INV-${String(i + 1).padStart(5, '0')}`,
        );
      }
    });
  });
});
