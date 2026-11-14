import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { admin, emailOTP } from 'better-auth/plugins';
import type { PrismaClient } from '../generated/prisma/client';
import type { EmailSender } from '../notifications/email-sender';

export const AUTH = Symbol('AUTH');

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
