import {
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { UpdateSettingsDto } from './dto/update-settings.dto';

@Injectable()
export class SettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  /**
   * Retrieves all system settings for the active organization.
   */
  async getAllSettings() {
    const org = await this.prisma.organization.findFirst();
    if (!org) {
      throw new NotFoundException('Organization profile not found');
    }

    const items = await this.prisma.systemSetting.findMany({
      where: { organizationId: org.id },
      orderBy: [{ group: 'asc' }, { key: 'asc' }],
    });

    // Build a clean key-value lookup map
    const map: Record<string, string> = {};
    for (const item of items) {
      map[item.key] = item.value;
    }

    return {
      items,
      map,
    };
  }

  /**
   * Retrieves a single setting by key.
   */
  async getSetting(key: string): Promise<string | null> {
    const org = await this.prisma.organization.findFirst();
    if (!org) return null;

    const setting = await this.prisma.systemSetting.findUnique({
      where: {
        organizationId_key: {
          organizationId: org.id,
          key,
        },
      },
    });

    return setting ? setting.value : null;
  }

  /**
   * Updates or inserts a collection of system settings.
   */
  async updateSettings(dto: UpdateSettingsDto, userId?: string) {
    const org = await this.prisma.organization.findFirst();
    if (!org) {
      throw new NotFoundException('Organization profile not found');
    }

    const updatedKeys: string[] = [];

    await this.prisma.$transaction(async (tx) => {
      for (const item of dto.settings) {
        await tx.systemSetting.upsert({
          where: {
            organizationId_key: {
              organizationId: org.id,
              key: item.key,
            },
          },
          update: {
            value: item.value,
            dataType: item.dataType,
            group: item.group,
            description: item.description,
          },
          create: {
            organizationId: org.id,
            key: item.key,
            value: item.value,
            dataType: item.dataType || 'STRING',
            group: item.group || 'GENERAL',
            description: item.description,
          },
        });
        updatedKeys.push(item.key);
      }
    });

    await this.auditService.log({
      userId,
      action: 'UPDATE_SETTINGS',
      entity: 'SYSTEM_SETTING',
      entityId: org.id,
      details: { updatedKeys },
    });

    return this.getAllSettings();
  }
}
