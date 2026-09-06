import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS_KEY, ROLE_ADMIN } from '../constants';
import { CurrentUserPayload } from '../dto/current-user.dto';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredPermissions = this.reflector.getAllAndOverride<string[]>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );

    // If no specific permissions are declared, allow access
    if (!requiredPermissions || requiredPermissions.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<{ user?: CurrentUserPayload }>();
    const user = request.user;

    if (!user) {
      throw new ForbiddenException(
        'You do not have permission to perform this action.',
      );
    }

    // Administrator role has full system access
    if (user.roles && user.roles.includes(ROLE_ADMIN)) {
      return true;
    }

    const userPermissions = new Set(user.permissions || []);
    const hasAllRequired = requiredPermissions.every((perm) =>
      userPermissions.has(perm),
    );

    if (!hasAllRequired) {
      throw new ForbiddenException(
        'You do not have permission to perform this action.',
      );
    }

    return true;
  }
}
