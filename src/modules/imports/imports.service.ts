import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ImportParserService } from './services/import-parser.service';
import { ImportValidatorService } from './services/import-validator.service';
import { ImportExecutorService } from './services/import-executor.service';
import { UploadImportDto } from './dto/upload-import.dto';
import { QueryImportDto } from './dto/query-import.dto';
import {
  ImportType,
  ImportJobStatus,
  Prisma,
} from '@prisma/client';
import * as XLSX from 'xlsx';

@Injectable()
export class ImportsService {
  private readonly logger = new Logger(ImportsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly parserService: ImportParserService,
    private readonly validatorService: ImportValidatorService,
    private readonly executorService: ImportExecutorService,
  ) {}

  private async getOrganizationId(): Promise<string> {
    const org = await this.prisma.organization.findFirst();
    if (!org) {
      throw new NotFoundException('Organization profile not found');
    }
    return org.id;
  }

  private async getDefaultBranchId(organizationId: string): Promise<string> {
    const branch = await this.prisma.branch.findFirst({
      where: { organizationId, isActive: true },
      orderBy: [{ isHeadOffice: 'desc' }, { createdAt: 'asc' }],
    });
    if (!branch) {
      throw new NotFoundException('No active branch found');
    }
    return branch.id;
  }

  /**
   * Uploads, parses, and validates an import file, creating a durable ImportJob.
   */
  async uploadFile(
    file: Express.Multer.File,
    dto: UploadImportDto,
    userId?: string,
  ) {
    if (!file || !file.buffer || file.buffer.length === 0) {
      throw new BadRequestException('No file uploaded or file is empty.');
    }

    const orgId = await this.getOrganizationId();
    const branchId = dto.branchId || (await this.getDefaultBranchId(orgId));

    // Validate file extension
    const originalFilename = file.originalname || 'import_file.csv';
    const lowerName = originalFilename.toLowerCase();
    if (!lowerName.endsWith('.csv') && !lowerName.endsWith('.xlsx') && !lowerName.endsWith('.xls')) {
      throw new BadRequestException('Invalid file format. Only .csv and .xlsx files are supported.');
    }

    // 1. Parse spreadsheet buffer
    const parseResult = this.parserService.parseBuffer(file.buffer, originalFilename);

    if (parseResult.totalRows === 0) {
      throw new BadRequestException('The uploaded file does not contain any valid data rows.');
    }

    // 2. Validate domain rules and resolve references
    const validationResult = await this.validatorService.validate(
      dto.type,
      orgId,
      parseResult.rows,
      branchId,
    );

    // 3. Determine status (READY only if there are valid rows and zero blocking errors)
    let status: ImportJobStatus = ImportJobStatus.VALIDATING;
    if (validationResult.invalidRows === 0 && validationResult.validRows > 0) {
      status = ImportJobStatus.READY;
    } else if (validationResult.validRows === 0) {
      status = ImportJobStatus.FAILED;
    }

    // 4. Persist ImportJob
    const job = await this.prisma.importJob.create({
      data: {
        organizationId: orgId,
        branchId,
        type: dto.type,
        status,
        originalFilename,
        totalRows: validationResult.totalRows,
        validRows: validationResult.validRows,
        invalidRows: validationResult.invalidRows,
        importedRows: 0,
        failedRows: validationResult.invalidRows,
        createdById: userId || null,
        metadata: {
          originalFilename,
          fileSize: file.size,
          mimeType: file.mimetype,
          summary: validationResult.summary,
          errors: validationResult.errors.slice(0, 500), // bounded error storage
          warnings: validationResult.warnings.slice(0, 500),
          previewRows: validationResult.previewRows.slice(0, 100), // preview sample
          parsedPayload: validationResult.parsedRows, // bounded valid rows for execution
        } as unknown as Prisma.InputJsonValue,
      },
      include: {
        createdByUser: {
          select: { id: true, username: true, displayName: true },
        },
        branch: {
          select: { id: true, code: true, name: true },
        },
      },
    });

    await this.auditService.log({
      userId,
      action: 'UPLOAD_IMPORT_FILE',
      entity: 'IMPORT_JOB',
      entityId: job.id,
      details: {
        type: job.type,
        filename: originalFilename,
        totalRows: job.totalRows,
        validRows: job.validRows,
        invalidRows: job.invalidRows,
        status: job.status,
      },
    });

    return {
      job: {
        id: job.id,
        type: job.type,
        status: job.status,
        originalFilename: job.originalFilename,
        totalRows: job.totalRows,
        validRows: job.validRows,
        invalidRows: job.invalidRows,
        createdAt: job.createdAt,
      },
      preview: {
        totalRows: validationResult.totalRows,
        validRows: validationResult.validRows,
        invalidRows: validationResult.invalidRows,
        errors: validationResult.errors,
        warnings: validationResult.warnings,
        summary: validationResult.summary,
        previewRows: validationResult.previewRows,
      },
    };
  }

  /**
   * Retrieves paginated list of past import jobs.
   */
  async findAll(query: QueryImportDto) {
    const orgId = await this.getOrganizationId();
    const page = query.page || 1;
    const limit = query.limit || 20;
    const skip = (page - 1) * limit;

    const where: Prisma.ImportJobWhereInput = {
      organizationId: orgId,
    };

    if (query.type) {
      where.type = query.type;
    }

    if (query.status) {
      where.status = query.status;
    }

    if (query.search && query.search.trim().length > 0) {
      const term = query.search.trim();
      where.originalFilename = { contains: term, mode: 'insensitive' };
    }

    const [total, items] = await Promise.all([
      this.prisma.importJob.count({ where }),
      this.prisma.importJob.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          createdByUser: {
            select: { id: true, username: true, displayName: true },
          },
          branch: {
            select: { id: true, code: true, name: true },
          },
        },
      }),
    ]);

    return {
      items: items.map((job) => ({
        id: job.id,
        type: job.type,
        status: job.status,
        originalFilename: job.originalFilename,
        totalRows: job.totalRows,
        validRows: job.validRows,
        invalidRows: job.invalidRows,
        importedRows: job.importedRows,
        failedRows: job.failedRows,
        startedAt: job.startedAt,
        completedAt: job.completedAt,
        createdAt: job.createdAt,
        createdByUser: job.createdByUser,
        branch: job.branch,
      })),
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Retrieves full details for a specific import job.
   */
  async findOne(id: string) {
    const orgId = await this.getOrganizationId();
    const job = await this.prisma.importJob.findFirst({
      where: { id, organizationId: orgId },
      include: {
        createdByUser: {
          select: { id: true, username: true, displayName: true },
        },
        branch: {
          select: { id: true, code: true, name: true },
        },
      },
    });

    if (!job) {
      throw new NotFoundException(`Import job with ID "${id}" not found.`);
    }

    return job;
  }

  /**
   * Retrieves preview rows and validation result for an import job.
   */
  async getPreview(id: string) {
    const job = await this.findOne(id);
    const metadata = (job.metadata as Record<string, unknown>) || {};

    return {
      id: job.id,
      type: job.type,
      status: job.status,
      originalFilename: job.originalFilename,
      totalRows: job.totalRows,
      validRows: job.validRows,
      invalidRows: job.invalidRows,
      summary: metadata.summary || {},
      errors: metadata.errors || [],
      warnings: metadata.warnings || [],
      previewRows: metadata.previewRows || [],
    };
  }

  /**
   * Generates a downloadable CSV containing all validation errors for a job.
   */
  async exportErrorsCsv(id: string): Promise<{ buffer: Buffer; filename: string }> {
    const job = await this.findOne(id);
    const metadata = (job.metadata as Record<string, unknown>) || {};
    const errors = (metadata.errors as Array<Record<string, unknown>>) || [];

    const rows = errors.map((err) => ({
      'Row Number': err.row,
      'Field / Column': err.field,
      'Error Code': err.code,
      'Message': err.message,
      'Value': err.value !== undefined ? JSON.stringify(err.value) : '',
    }));

    const worksheet = XLSX.utils.json_to_sheet(rows, {
      header: ['Row Number', 'Field / Column', 'Error Code', 'Message', 'Value'],
    });
    const csvString = XLSX.utils.sheet_to_csv(worksheet);

    return {
      buffer: Buffer.from(csvString, 'utf-8'),
      filename: `import_errors_${job.type.toLowerCase()}_${job.id.slice(0, 8)}.csv`,
    };
  }

  /**
   * Executes a confirmed import job.
   */
  async confirmImport(id: string, userId?: string) {
    return this.executorService.executeImport(id, userId);
  }

  /**
   * Cancels an import job before execution.
   */
  async cancelImport(id: string, userId?: string) {
    const orgId = await this.getOrganizationId();
    const job = await this.prisma.importJob.findFirst({
      where: { id, organizationId: orgId },
    });

    if (!job) {
      throw new NotFoundException(`Import job with ID "${id}" not found.`);
    }

    if (job.status === ImportJobStatus.COMPLETED) {
      throw new ConflictException('Completed imports cannot be cancelled.');
    }

    if (job.status === ImportJobStatus.CANCELLED) {
      return job;
    }

    const updated = await this.prisma.importJob.update({
      where: { id },
      data: {
        status: ImportJobStatus.CANCELLED,
        completedAt: new Date(),
      },
    });

    await this.auditService.log({
      userId,
      action: 'CANCEL_IMPORT_JOB',
      entity: 'IMPORT_JOB',
      entityId: job.id,
      details: {
        type: job.type,
        originalFilename: job.originalFilename,
        previousStatus: job.status,
      },
    });

    return updated;
  }

  /**
   * Generates a starter template for a specific import type.
   */
  getTemplate(type: ImportType): { buffer: Buffer; filename: string } {
    return this.parserService.generateCsvTemplate(type);
  }
}
