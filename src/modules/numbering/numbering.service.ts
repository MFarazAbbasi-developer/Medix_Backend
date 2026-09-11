import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { DocumentType, Prisma } from '@prisma/client';
import { UpdateNumberingSeriesDto } from './dto/update-numbering-series.dto';

export interface GeneratedNumberResult {
  documentNumber: string;
  seriesId: string;
  sequence: number;
}

@Injectable()
export class NumberingService {
  private readonly logger = new Logger(NumberingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  /**
   * Formats a sequential number given prefix, number, padding, and optional suffix.
   */
  formatNumber(
    prefix: string,
    sequence: number,
    padding: number,
    suffix?: string | null,
  ): string {
    const padded = String(sequence).padStart(padding, '0');
    return `${prefix || ''}${padded}${suffix || ''}`;
  }

  /**
   * Retrieves all numbering series, optionally filtered by branch.
   */
  async getSeriesList(branchId?: string) {
    const org = await this.prisma.organization.findFirst();
    if (!org) {
      throw new NotFoundException('Organization profile not found');
    }

    const where: Prisma.NumberingSeriesWhereInput = { organizationId: org.id };
    if (branchId) {
      where.OR = [{ branchId }, { branchId: null }];
    }

    return this.prisma.numberingSeries.findMany({
      where,
      orderBy: [{ documentType: 'asc' }, { branchId: 'asc' }],
      include: {
        branch: {
          select: {
            id: true,
            name: true,
            code: true,
          },
        },
      },
    });
  }

  /**
   * Updates a numbering series configuration.
   */
  async updateSeries(
    id: string,
    dto: UpdateNumberingSeriesDto,
    userId?: string,
  ) {
    const series = await this.prisma.numberingSeries.findUnique({
      where: { id },
    });

    if (!series) {
      throw new NotFoundException(`Numbering series with ID "${id}" not found`);
    }

    const updated = await this.prisma.numberingSeries.update({
      where: { id },
      data: dto,
    });

    await this.auditService.log({
      userId,
      action: 'UPDATE_NUMBERING_SERIES',
      entity: 'NUMBERING_SERIES',
      entityId: id,
      details: {
        documentType: series.documentType,
        changes: dto,
      },
    });

    return updated;
  }

  /**
   * Finds the best matching active series for a document type.
   * Priority: branch-specific series first, fallback to organization-wide (global) series.
   */
  async findMatchingSeries(
    documentType: DocumentType,
    branchId?: string,
    tx?: Prisma.TransactionClient,
  ) {
    const db = tx || this.prisma;
    const org = await db.organization.findFirst();
    if (!org) {
      throw new NotFoundException('Organization profile not found');
    }

    // 1. Check branch-specific series if branchId provided
    if (branchId) {
      const branchSeries = await db.numberingSeries.findFirst({
        where: {
          organizationId: org.id,
          branchId,
          documentType,
          isActive: true,
        },
      });

      if (branchSeries) {
        return branchSeries;
      }
    }

    // 2. Fallback to global / default series (branchId is null)
    const globalSeries = await db.numberingSeries.findFirst({
      where: {
        organizationId: org.id,
        branchId: null,
        documentType,
        isActive: true,
      },
    });

    if (globalSeries) {
      return globalSeries;
    }

    // 3. Fallback to any active series for documentType
    const anyActiveSeries = await db.numberingSeries.findFirst({
      where: {
        organizationId: org.id,
        documentType,
        isActive: true,
      },
    });

    if (anyActiveSeries) {
      return anyActiveSeries;
    }

    throw new NotFoundException(
      `No active numbering series configured for document type "${documentType}"`,
    );
  }

  /**
   * Previews the next number without incrementing the database sequence.
   */
  async previewNextNumber(
    documentType: DocumentType,
    branchId?: string,
    tx?: Prisma.TransactionClient,
  ): Promise<GeneratedNumberResult> {
    const series = await this.findMatchingSeries(documentType, branchId, tx);
    const preview = this.formatNumber(
      series.prefix,
      series.nextNumber,
      series.padding,
      series.suffix,
    );

    return {
      documentNumber: preview,
      seriesId: series.id,
      sequence: series.nextNumber,
    };
  }

  /**
   * Atomically generates and reserves the next sequential document number.
   * Uses PostgreSQL UPDATE ... RETURNING to guarantee transaction safety and concurrency isolation
   * across multiple simultaneous LAN stations without sequence collisions.
   */
  async generateNextNumber(
    documentType: DocumentType,
    branchId?: string,
    tx?: Prisma.TransactionClient,
  ): Promise<GeneratedNumberResult> {
    const series = await this.findMatchingSeries(documentType, branchId, tx);
    const db = tx || this.prisma;

    // Genuinely atomic increment directly in PostgreSQL
    const rows = await db.$queryRaw<
      Array<{
        id: string;
        prefix: string;
        suffix: string | null;
        current_number: number;
        padding: number;
      }>
    >`
      UPDATE "numbering_series"
      SET "next_number" = "next_number" + 1,
          "updated_at" = NOW()
      WHERE "id" = ${series.id}
      RETURNING "id", "prefix", "suffix", ("next_number" - 1)::integer AS "current_number", "padding";
    `;

    if (!rows || rows.length === 0) {
      throw new BadRequestException(
        `Failed to generate sequence for series "${series.id}"`,
      );
    }

    const row = rows[0];
    const seq = Number(row.current_number);
    const documentNumber = this.formatNumber(
      row.prefix,
      seq,
      row.padding,
      row.suffix,
    );

    return {
      documentNumber,
      seriesId: row.id,
      sequence: seq,
    };
  }
}
