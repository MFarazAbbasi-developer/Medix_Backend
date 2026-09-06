import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { RequirePermissions } from '../../auth/decorators/permissions.decorator';
import { PrismaService } from '../../../prisma/prisma.service';

@Controller('admin/system-info')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class SystemInfoController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @RequirePermissions('dashboard.view')
  async getSystemInfo() {
    const memory = process.memoryUsage();
    const uptimeSec = Math.floor(process.uptime());

    const [
      usersCount,
      rolesCount,
      productsCount,
      batchesCount,
      customersCount,
      suppliersCount,
      invoicesCount,
      auditLogsCount,
      org,
      branches,
    ] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.role.count(),
      this.prisma.product.count(),
      this.prisma.batch.count(),
      this.prisma.customer.count(),
      this.prisma.supplier.count(),
      this.prisma.salesInvoice.count(),
      this.prisma.auditLog.count(),
      this.prisma.organization.findFirst(),
      this.prisma.branch.findMany({
        select: { id: true, name: true, code: true, isHeadOffice: true, isActive: true },
      }),
    ]);

    return {
      application: {
        name: 'Medix by FARMAX',
        version: '1.0.0-phase8.admin-reliability',
        environment: process.env.NODE_ENV || 'development',
        nodeVersion: process.version,
        platform: process.platform,
        arch: process.arch,
      },
      server: {
        uptimeSeconds: uptimeSec,
        serverTime: new Date().toISOString(),
        memoryUsageMb: {
          heapUsed: Math.round(memory.heapUsed / 1024 / 1024),
          heapTotal: Math.round(memory.heapTotal / 1024 / 1024),
          rss: Math.round(memory.rss / 1024 / 1024),
        },
      },
      database: {
        status: 'CONNECTED',
        engine: 'PostgreSQL',
        stats: {
          usersCount,
          rolesCount,
          productsCount,
          batchesCount,
          customersCount,
          suppliersCount,
          invoicesCount,
          auditLogsCount,
        },
      },
      deployment: {
        organization: org
          ? {
              id: org.id,
              name: org.name,
              legalName: org.legalName,
              drugLicense: org.drugSaleLicenseNo,
              ntn: org.ntn,
              strn: org.strn,
            }
          : null,
        branches,
      },
    };
  }
}
