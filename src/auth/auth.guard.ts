import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { fromNodeHeaders } from 'better-auth/node';
import type { Request } from 'express';
import { IS_PUBLIC, ROLES } from '../common/auth/auth.decorators';
import { AppError } from '../common/errors/app-error';
import { AUTH, type Auth, type SessionUser } from './auth';

// Global guard: login required unless @Public(); @Roles(...) narrows further.
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(AUTH) private readonly auth: Auth,
  ) {}

  async canActivate(ctx: ExecutionContext) {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets))
      return true;

    const req = ctx
      .switchToHttp()
      .getRequest<Request & { user?: SessionUser }>();
    const session = await this.auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });
    if (!session) throw new AppError('UNAUTHENTICATED', 401, 'Login required');

    const { user } = session;
    // A ban set while a session was alive must still take effect immediately.
    if (user.banned && (!user.banExpires || user.banExpires > new Date())) {
      throw new AppError('FORBIDDEN', 403, 'This account is banned');
    }

    const roles = this.reflector.getAllAndOverride<string[] | undefined>(
      ROLES,
      targets,
    );
    if (roles && !roles.includes(user.role ?? 'user')) {
      throw new AppError('FORBIDDEN', 403, 'Not allowed');
    }

    req.user = user;
    return true;
  }
}
