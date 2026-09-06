import { Injectable, UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  handleRequest<TUser = unknown>(err: unknown, user: TUser, info: unknown): TUser {
    if (err || !user) {
      const message =
        info instanceof Error
          ? info.message
          : 'Authentication token is missing or invalid';
      throw err || new UnauthorizedException(message);
    }
    return user;
  }
}
