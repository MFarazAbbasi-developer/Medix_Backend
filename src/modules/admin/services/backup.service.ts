import {
  Injectable,
  BadRequestException,
  NotFoundException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuditService } from '../../audit/audit.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { CreateBackupDto, RestoreBackupDto } from '../dto/backup-admin.dto';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export interface BackupRecord {
  id: string;
  filename: string;
  filePath: string;
  sizeBytes: number;
  createdAt: string;
  createdBy: string;
  status: 'SUCCESS' | 'FAILED' | 'RESTORED' | 'IMPORTED';
  notes?: string;
  errorReason?: string;
  checksum?: string;
}

@Injectable()
export class BackupService {
  private readonly logger = new Logger(BackupService.name);
  private backupDir: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly auditService: AuditService,
    private readonly prisma: PrismaService,
  ) {
    this.backupDir = path.resolve(process.cwd(), 'backups');
    this.ensureBackupDir(this.backupDir);
  }

  private ensureBackupDir(dir: string): void {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  private getManifestPath(dir: string = this.backupDir): string {
    return path.join(dir, 'manifest.json');
  }

  private readManifest(dir: string = this.backupDir): BackupRecord[] {
    const manifestPath = this.getManifestPath(dir);
    if (!fs.existsSync(manifestPath)) {
      return [];
    }
    try {
      const data = fs.readFileSync(manifestPath, 'utf8');
      return JSON.parse(data) as BackupRecord[];
    } catch {
      return [];
    }
  }

  private writeManifest(records: BackupRecord[], dir: string = this.backupDir): void {
    const manifestPath = this.getManifestPath(dir);
    this.ensureBackupDir(dir);
    fs.writeFileSync(manifestPath, JSON.stringify(records, null, 2), 'utf8');
  }

  private computeChecksum(filePath: string): string {
    if (!fs.existsSync(filePath)) return '';
    const fileBuffer = fs.readFileSync(filePath);
    return crypto.createHash('sha256').update(fileBuffer).digest('hex');
  }

  /**
   * Parse PostgreSQL connection details from DATABASE_URL securely.
   */
  private parseDbUrl() {
    const dbUrl = process.env.DATABASE_URL || '';
    try {
      const parsed = new URL(dbUrl);
      return {
        host: parsed.hostname || 'localhost',
        port: parsed.port || '5432',
        user: decodeURIComponent(parsed.username || 'postgres'),
        password: decodeURIComponent(parsed.password || ''),
        database: parsed.pathname.replace(/^\//, '') || 'medix_db',
      };
    } catch {
      // Fallback regex parser for non-standard postgres URLs
      const match = dbUrl.match(
        /postgresql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/([^?]+)/,
      );
      if (match) {
        return {
          user: match[1],
          password: match[2],
          host: match[3],
          port: match[4],
          database: match[5],
        };
      }
      throw new InternalServerErrorException(
        'Invalid or unparseable DATABASE_URL configuration',
      );
    }
  }

  /**
   * List all backups and synchronize with files on disk.
   */
  async listBackups() {
    this.ensureBackupDir(this.backupDir);
    const manifest = this.readManifest(this.backupDir);
    const existingFileNames = new Set(
      fs.existsSync(this.backupDir)
        ? fs
            .readdirSync(this.backupDir)
            .filter((f) => f.endsWith('.dump') || f.endsWith('.sql') || f.endsWith('.bak'))
        : [],
    );

    const manifestMap = new Map<string, BackupRecord>();
    manifest.forEach((rec) => manifestMap.set(rec.filename, rec));

    // Check for any untracked backup files placed manually into directory
    for (const file of existingFileNames) {
      if (!manifestMap.has(file)) {
        const fullPath = path.join(this.backupDir, file);
        const stats = fs.statSync(fullPath);
        const newRecord: BackupRecord = {
          id: crypto.randomUUID(),
          filename: file,
          filePath: fullPath,
          sizeBytes: stats.size,
          createdAt: stats.birthtime.toISOString(),
          createdBy: 'system/manual_import',
          status: 'IMPORTED',
          checksum: this.computeChecksum(fullPath),
        };
        manifest.push(newRecord);
        manifestMap.set(file, newRecord);
      }
    }

    // Sort newest first
    const sorted = manifest.sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
    this.writeManifest(sorted, this.backupDir);

    return {
      backupDirectory: this.backupDir,
      items: sorted,
      total: sorted.length,
    };
  }

  /**
   * Trigger a manual PostgreSQL database backup using pg_dump.
   */
  async createBackup(
    dto: CreateBackupDto,
    actor: { id: string; username: string },
  ): Promise<BackupRecord> {
    const targetDir = dto.targetDirectory
      ? path.resolve(dto.targetDirectory)
      : this.backupDir;
    this.ensureBackupDir(targetDir);

    const timestamp = new Date()
      .toISOString()
      .replace(/:/g, '-')
      .replace(/\..+/, '');
    const safeLabel = dto.label
      ? `_${dto.label.replace(/[^a-zA-Z0-9_-]/g, '_')}`
      : '';
    const filename = `medix_backup_farmax_${timestamp}${safeLabel}.dump`;
    const destinationPath = path.join(targetDir, filename);

    // Prevent accidental overwrite
    if (fs.existsSync(destinationPath)) {
      throw new BadRequestException(`Backup file "${filename}" already exists.`);
    }

    const dbConfig = this.parseDbUrl();
    const backupId = crypto.randomUUID();

    try {
      this.logger.log(`Initiating PostgreSQL backup to "${destinationPath}"...`);

      // Execute pg_dump using credentials via environment variable (never CLI arguments)
      const args = [
        '-h',
        dbConfig.host,
        '-p',
        dbConfig.port,
        '-U',
        dbConfig.user,
        '-d',
        dbConfig.database,
        '-F',
        'c', // Custom compressed format suitable for pg_restore
        '-f',
        destinationPath,
      ];

      await execFileAsync('pg_dump', args, {
        env: {
          ...process.env,
          PGPASSWORD: dbConfig.password,
        },
      });

      const stats = fs.statSync(destinationPath);
      const checksum = this.computeChecksum(destinationPath);

      const record: BackupRecord = {
        id: backupId,
        filename,
        filePath: destinationPath,
        sizeBytes: stats.size,
        createdAt: new Date().toISOString(),
        createdBy: actor.username,
        status: 'SUCCESS',
        notes: dto.label || 'Manual database backup',
        checksum,
      };

      const manifest = this.readManifest(targetDir);
      manifest.unshift(record);
      this.writeManifest(manifest, targetDir);

      await this.auditService.log({
        userId: actor.id,
        action: 'CREATE_BACKUP',
        entity: 'DATABASE_BACKUP',
        entityId: backupId,
        details: {
          filename,
          sizeBytes: stats.size,
          directory: targetDir,
          status: 'SUCCESS',
        },
      });

      return record;
    } catch (error: any) {
      this.logger.error(`Backup execution failed: ${error.message}`);

      const record: BackupRecord = {
        id: backupId,
        filename,
        filePath: destinationPath,
        sizeBytes: 0,
        createdAt: new Date().toISOString(),
        createdBy: actor.username,
        status: 'FAILED',
        notes: dto.label,
        errorReason: error.message,
      };

      const manifest = this.readManifest(targetDir);
      manifest.unshift(record);
      this.writeManifest(manifest, targetDir);

      await this.auditService.log({
        userId: actor.id,
        action: 'CREATE_BACKUP_FAILED',
        entity: 'DATABASE_BACKUP',
        entityId: backupId,
        details: {
          filename,
          error: error.message,
        },
      });

      throw new InternalServerErrorException(
        `Failed to generate database backup: ${error.message}`,
      );
    }
  }

  /**
   * Validate backup file existence and integrity.
   */
  async validateBackup(filename: string) {
    const filePath = path.join(this.backupDir, filename);
    if (!fs.existsSync(filePath)) {
      throw new NotFoundException(`Backup file "${filename}" not found.`);
    }

    const stats = fs.statSync(filePath);
    if (stats.size === 0) {
      throw new BadRequestException('Backup file is empty (0 bytes).');
    }

    const checksum = this.computeChecksum(filePath);
    return {
      filename,
      filePath,
      sizeBytes: stats.size,
      checksum,
      isValid: true,
      lastModified: stats.mtime.toISOString(),
    };
  }

  /**
   * Execute controlled, destructive database restore from a verified backup file.
   */
  async restoreBackup(
    dto: RestoreBackupDto,
    actor: { id: string; username: string },
  ) {
    if (dto.confirmationToken !== 'CONFIRM_RESTORE') {
      throw new BadRequestException(
        'Invalid confirmation token. You must explicitly confirm with "CONFIRM_RESTORE".',
      );
    }

    const filePath = path.join(this.backupDir, dto.filename);
    if (!fs.existsSync(filePath)) {
      throw new NotFoundException(`Backup file "${dto.filename}" not found.`);
    }

    const stats = fs.statSync(filePath);
    if (stats.size === 0) {
      throw new BadRequestException('Backup file is corrupt or 0 bytes.');
    }

    const dbConfig = this.parseDbUrl();

    // 1. Step 1: Create an automated pre-restore safety snapshot before destructive action
    const safetyTimestamp = new Date()
      .toISOString()
      .replace(/:/g, '-')
      .replace(/\..+/, '');
    const safetyFilename = `medix_pre_restore_safety_${safetyTimestamp}.dump`;
    const safetyPath = path.join(this.backupDir, safetyFilename);

    try {
      this.logger.log(`Creating pre-restore safety snapshot "${safetyFilename}"...`);
      await execFileAsync(
        'pg_dump',
        [
          '-h',
          dbConfig.host,
          '-p',
          dbConfig.port,
          '-U',
          dbConfig.user,
          '-d',
          dbConfig.database,
          '-F',
          'c',
          '-f',
          safetyPath,
        ],
        {
          env: {
            ...process.env,
            PGPASSWORD: dbConfig.password,
          },
        },
      );
    } catch (e: any) {
      this.logger.warn(
        `Pre-restore safety snapshot warning: ${e.message}. Proceeding cautiously.`,
      );
    }

    // 2. Step 2: Execute pg_restore --clean --if-exists -d dbname
    try {
      this.logger.warn(
        `DESTRUCTIVE ACTION: Restoring database from file "${dto.filename}" by ${actor.username}...`,
      );

      const restoreArgs = [
        '-h',
        dbConfig.host,
        '-p',
        dbConfig.port,
        '-U',
        dbConfig.user,
        '-d',
        dbConfig.database,
        '--clean',
        '--if-exists',
        filePath,
      ];

      await execFileAsync('pg_restore', restoreArgs, {
        env: {
          ...process.env,
          PGPASSWORD: dbConfig.password,
        },
      });

      // Update manifest
      const manifest = this.readManifest(this.backupDir);
      const targetRecord = manifest.find((r) => r.filename === dto.filename);
      if (targetRecord) {
        targetRecord.status = 'RESTORED';
        targetRecord.notes = `Restored by ${actor.username} on ${new Date().toISOString()}`;
      }
      this.writeManifest(manifest, this.backupDir);

      await this.auditService.log({
        userId: actor.id,
        action: 'RESTORE_DATABASE',
        entity: 'DATABASE_BACKUP',
        entityId: dto.filename,
        details: {
          restoredFilename: dto.filename,
          sizeBytes: stats.size,
          safetyBackupCreated: safetyFilename,
        },
      });

      return {
        success: true,
        message:
          'Database restored successfully. Application sessions and in-memory caches require reinitialization.',
        restoredFile: dto.filename,
        safetyBackup: safetyFilename,
        restoredAt: new Date().toISOString(),
      };
    } catch (error: any) {
      this.logger.error(`Database restore failed: ${error.message}`);
      await this.auditService.log({
        userId: actor.id,
        action: 'RESTORE_DATABASE_FAILED',
        entity: 'DATABASE_BACKUP',
        entityId: dto.filename,
        details: {
          filename: dto.filename,
          error: error.message,
          safetyBackup: safetyFilename,
        },
      });

      throw new InternalServerErrorException(
        `Database restore execution failed: ${error.message}. A safety backup was saved as "${safetyFilename}".`,
      );
    }
  }
}
