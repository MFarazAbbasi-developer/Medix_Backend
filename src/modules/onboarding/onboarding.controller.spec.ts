import { describe, it, expect, beforeEach, vi } from 'vitest';
import { OnboardingController } from './onboarding.controller';
import { OnboardingService } from './onboarding.service';

describe('OnboardingController', () => {
  let controller: OnboardingController;
  let mockService: any;

  beforeEach(() => {
    mockService = {
      getStatus: vi.fn().mockResolvedValue({
        isInitialized: false,
        overallProgress: 75,
      }),
      completeOnboarding: vi.fn().mockResolvedValue({
        isInitialized: true,
        overallProgress: 100,
      }),
      resetOnboarding: vi.fn().mockResolvedValue({
        isInitialized: false,
        overallProgress: 50,
      }),
    };

    controller = new OnboardingController(mockService as unknown as OnboardingService);
  });

  it('should call getStatus', async () => {
    const res = await controller.getStatus();
    expect(mockService.getStatus).toHaveBeenCalled();
    expect(res.overallProgress).toBe(75);
  });

  it('should call completeOnboarding', async () => {
    const res = await controller.completeOnboarding('user-1');
    expect(mockService.completeOnboarding).toHaveBeenCalledWith('user-1');
    expect(res.isInitialized).toBe(true);
  });

  it('should call resetOnboarding', async () => {
    const res = await controller.resetOnboarding('user-1');
    expect(mockService.resetOnboarding).toHaveBeenCalledWith('user-1');
    expect(res.isInitialized).toBe(false);
  });
});
