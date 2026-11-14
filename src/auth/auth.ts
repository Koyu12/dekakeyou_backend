import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { admin, emailOTP } from 'better-auth/plugins';
import type { PrismaClient } from '../generated/prisma/client';
import type { EmailSender } from '../notifications/email-sender';

export const AUTH = Symbol('AUTH');

export const ADMIN_PLUGIN_PATHS = [
  '/admin/ban-user',
  '/admin/unban-user',
  '/admin/create-user',
  '/admin/get-user',
  '/admin/update-user',
  '/admin/remove-user',
  '/admin/list-users',
  '/admin/set-role',
  '/admin/set-user-password',
  '/admin/has-permission',
  '/admin/impersonate-user',
  '/admin/stop-impersonating',
  '/admin/list-user-sessions',
  '/admin/revoke-user-session',
  '/admin/revoke-user-sessions',
];

export function createAuth(prisma: PrismaClient, emailSender: EmailSender) {
  const { BETTER_AUTH_URL, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } =
    process.env;

  return betterAuth({
    // The public site URL: the browser reaches /api/auth through the frontend's /api rewrite (ADR-0002).
    baseURL: BETTER_AUTH_URL,
    basePath: '/api/auth',
    secret: process.env.BETTER_AUTH_SECRET,
    trustedOrigins: BETTER_AUTH_URL ? [BETTER_AUTH_URL] : [],
    database: prismaAdapter(prisma, { provider: 'postgresql' }),
    socialProviders:
      GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET
        ? {
            google: {
              clientId: GOOGLE_CLIENT_ID,
              clientSecret: GOOGLE_CLIENT_SECRET,
            },
          }
        : undefined,
    rateLimit: { storage: 'database' },
    // The admin plugin is only used for its role/ban fields and for blocking banned logins.
    // Its HTTP endpoints would bypass our own flows (a ban must also remove Events and free
    // places; users are anonymized, never hard-deleted), so all of them are switched off.
    disabledPaths: ADMIN_PLUGIN_PATHS,
    plugins: [
      emailOTP({
        sendVerificationOTP: ({ email, otp }) =>
          emailSender.send({
            to: email,
            subject: 'Your Dekakeyou login code',
            text: `Your login code is ${otp}. It expires in 5 minutes.`,
          }),
      }),
      admin(),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;
export type SessionUser = Auth['$Infer']['Session']['user'];
