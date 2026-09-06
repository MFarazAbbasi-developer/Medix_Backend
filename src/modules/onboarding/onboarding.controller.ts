import { Controller, Get, Post, UseGuards } from '@nestjs/common';
import { OnboardingService } from './onboarding.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@Controller('onboarding')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class OnboardingController {
  constructor(private readonly onboardingService: OnboardingService) {}

  /**
   * Retrieves comprehensive setup and onboarding readiness status.
   */
  @Get('status')
  @RequirePermissions('dashboard.view')
  async getStatus() {
    return this.onboardingService.getStatus();
  }

  /**
   * Finalizes system initialization and completes onboarding.
   */
  @Post('complete')
  @RequirePermissions('settings.manage')
  async completeOnboarding(@CurrentUser('userId') userId?: string) {
    return this.onboardingService.completeOnboarding(userId);
  }

  /**
   * Reopens onboarding mode.
   */
  @Post('reset')
  @RequirePermissions('settings.manage')
  async resetOnboarding(@CurrentUser('userId') userId?: string) {
    return this.onboardingService.resetOnboarding(userId);
  }
}
