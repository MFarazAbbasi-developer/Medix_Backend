import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermissionsGuard } from './permissions.guard';
import { ROLE_ADMIN } from '../constants';

describe('PermissionsGuard', () => {
  let guard: PermissionsGuard;
  let reflector: Reflector;

  beforeEach(() => {
    reflector = new Reflector();
    guard = new PermissionsGuard(reflector);
  });

  function createMockContext(user?: any): ExecutionContext {
    return {
      getHandler: vi.fn(),
      getClass: vi.fn(),
      switchToHttp: vi.fn().mockReturnValue({
        getRequest: vi.fn().mockReturnValue({ user }),
      }),
    } as unknown as ExecutionContext;
  }

  it('should allow access if no permissions are required on route', () => {
    vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);
    const context = createMockContext({ userId: 'u1', roles: [], permissions: [] });

    expect(guard.canActivate(context)).toBe(true);
  });

  it('should allow access if user has ADMIN role regardless of granular permissions', () => {
    vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['sales.cancel', 'settings.manage']);
    const context = createMockContext({
      userId: 'admin-id',
      roles: [ROLE_ADMIN],
      permissions: [],
    });

    expect(guard.canActivate(context)).toBe(true);
  });

  it('should allow access if user has all required permissions', () => {
    vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['sales.create', 'sales.view']);
    const context = createMockContext({
      userId: 'user-id',
      roles: ['OPERATOR'],
      permissions: ['dashboard.view', 'sales.view', 'sales.create'],
    });

    expect(guard.canActivate(context)).toBe(true);
  });

  it('should throw ForbiddenException if user lacks one of the required permissions', () => {
    vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['sales.create', 'sales.cancel']);
    const context = createMockContext({
      userId: 'user-id',
      roles: ['OPERATOR'],
      permissions: ['sales.view', 'sales.create'], // missing 'sales.cancel'
    });

    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('should throw ForbiddenException if no user is attached to request', () => {
    vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['dashboard.view']);
    const context = createMockContext(undefined);

    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });
});
