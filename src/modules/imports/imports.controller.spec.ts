import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ImportsController } from './imports.controller';
import { ImportsService } from './imports.service';
import { ImportType } from '@prisma/client';

describe('ImportsController', () => {
  let controller: ImportsController;
  let mockService: any;

  beforeEach(() => {
    mockService = {
      uploadFile: vi.fn().mockResolvedValue({ id: 'job-1' }),
      findAll: vi.fn().mockResolvedValue({ items: [], meta: {} }),
      findOne: vi.fn().mockResolvedValue({ id: 'job-1' }),
      getPreview: vi.fn().mockResolvedValue({ previewRows: [] }),
      exportErrorsCsv: vi.fn().mockResolvedValue({
        buffer: Buffer.from('errors'),
        filename: 'errors.csv',
      }),
      confirmImport: vi.fn().mockResolvedValue({ id: 'job-1', status: 'COMPLETED' }),
      cancelImport: vi.fn().mockResolvedValue({ id: 'job-1', status: 'CANCELLED' }),
      getTemplate: vi.fn().mockReturnValue({
        buffer: Buffer.from('template'),
        filename: 'template.csv',
      }),
    };

    controller = new ImportsController(mockService as unknown as ImportsService);
  });

  it('should call uploadFile on post upload', async () => {
    const mockFile = { originalname: 'test.csv', buffer: Buffer.from('data') } as any;
    await controller.uploadFile(mockFile, { type: ImportType.PRODUCTS }, 'user-1');
    expect(mockService.uploadFile).toHaveBeenCalledWith(mockFile, { type: ImportType.PRODUCTS }, 'user-1');
  });

  it('should call confirmImport on post confirm', async () => {
    await controller.confirmImport('11111111-1111-1111-1111-111111111111', 'user-1');
    expect(mockService.confirmImport).toHaveBeenCalledWith('11111111-1111-1111-1111-111111111111', 'user-1');
  });

  it('should call cancelImport on post cancel', async () => {
    await controller.cancelImport('11111111-1111-1111-1111-111111111111', 'user-1');
    expect(mockService.cancelImport).toHaveBeenCalledWith('11111111-1111-1111-1111-111111111111', 'user-1');
  });

  it('should serve downloadable template', async () => {
    const mockRes = {
      setHeader: vi.fn(),
      send: vi.fn(),
    } as any;

    await controller.getTemplate(ImportType.PRODUCTS, mockRes);
    expect(mockRes.setHeader).toHaveBeenCalledWith('Content-Type', 'text/csv; charset=utf-8');
    expect(mockRes.send).toHaveBeenCalled();
  });
});
