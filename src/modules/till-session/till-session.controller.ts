import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  Req,
} from '@nestjs/common';
import { TillSessionService } from './till-session.service';
import { OpenTillSessionDto } from './dto/open-till-session.dto';
import { RecordTillMovementDto } from './dto/record-movement.dto';
import { CountTillSessionDto } from './dto/count-till-session.dto';
import { CloseTillSessionDto } from './dto/close-till-session.dto';
import { QueryTillSessionDto } from './dto/query-till-session.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';

@Controller('till-sessions')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class TillSessionController {
  constructor(private readonly tillSessionService: TillSessionService) {}

  @Get('active')
  @RequirePermissions('cash_sessions.view')
  async getActiveSession(@Req() req: any, @Query('branchId') branchId?: string) {
    const userId = req.user?.sub || req.user?.id;
    return this.tillSessionService.getActiveSession(userId, branchId);
  }

  @Post('open')
  @RequirePermissions('cash_sessions.open')
  async openSession(
    @Body() dto: OpenTillSessionDto,
    @Req() req: any,
    @Query('branchId') branchId?: string,
  ) {
    const userId = req.user?.sub || req.user?.id;
    return this.tillSessionService.openSession(dto, userId, branchId);
  }

  @Post(':id/movement')
  @RequirePermissions('cash_sessions.adjust')
  async recordMovement(
    @Param('id') id: string,
    @Body() dto: RecordTillMovementDto,
    @Req() req: any,
  ) {
    const userId = req.user?.sub || req.user?.id;
    return this.tillSessionService.recordMovement(id, dto, userId);
  }

  @Post(':id/count')
  @RequirePermissions('cash_sessions.count')
  async countSession(
    @Param('id') id: string,
    @Body() dto: CountTillSessionDto,
    @Req() req: any,
  ) {
    const userId = req.user?.sub || req.user?.id;
    return this.tillSessionService.countSession(id, dto, userId);
  }

  @Post(':id/close')
  @RequirePermissions('cash_sessions.close')
  async closeSession(
    @Param('id') id: string,
    @Body() dto: CloseTillSessionDto,
    @Req() req: any,
  ) {
    const userId = req.user?.sub || req.user?.id;
    const permissions = req.user?.permissions || [];
    const roles = req.user?.roles || [];
    return this.tillSessionService.closeSession(id, dto, userId, permissions, roles);
  }

  @Get(':id/print')
  @RequirePermissions('cash_sessions.view')
  async getSessionPrintData(@Param('id') id: string) {
    return this.tillSessionService.getSessionPrintData(id);
  }

  @Get(':id')
  @RequirePermissions('cash_sessions.view')
  async getSessionById(@Param('id') id: string) {
    return this.tillSessionService.getSessionById(id);
  }

  @Get()
  @RequirePermissions('cash_sessions.view')
  async getSessions(@Query() query: QueryTillSessionDto) {
    return this.tillSessionService.getSessions(query);
  }
}
