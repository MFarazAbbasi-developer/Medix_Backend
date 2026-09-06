import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { CurrentUserPayload } from '../dto/current-user.dto';

export const CurrentUser = createParamDecorator(
  (
    field: keyof CurrentUserPayload | undefined,
    ctx: ExecutionContext,
  ): CurrentUserPayload | string | string[] | undefined => {
    const request = ctx.switchToHttp().getRequest<{ user?: CurrentUserPayload }>();
    const user = request.user;

    if (!user) {
      return undefined;
    }

    return field ? user[field] : user;
  },
);
