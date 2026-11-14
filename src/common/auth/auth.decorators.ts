import {
  createParamDecorator,
  ExecutionContext,
  SetMetadata,
} from '@nestjs/common';
import type { SessionUser } from '../../auth/auth';

export const IS_PUBLIC = 'isPublic';
export const ROLES = 'roles';

/** Opts an endpoint (or controller) out of the global login requirement. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Restricts an endpoint (or controller) to users with one of these roles. */
export const Roles = (...roles: string[]) => SetMetadata(ROLES, roles);

/** The logged-in user, set by the global AuthGuard. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext) =>
    ctx.switchToHttp().getRequest<{ user: SessionUser }>().user,
);
