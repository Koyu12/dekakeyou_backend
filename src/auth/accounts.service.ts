import { Injectable } from '@nestjs/common';
import { AppError } from '../common/errors/app-error';
import type { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const accountView = {
  id: true,
  name: true,
  email: true,
  role: true,
  banned: true,
  banReason: true,
  banExpires: true,
} satisfies Prisma.UserSelect;

// Writes to the auth-owned tables (User, Session) that other modules' flows need (ADR-0003).
@Injectable()
export class AccountsService {
  constructor(private readonly prisma: PrismaService) {}

  async findByEmail(email: string) {
    const user = await this.prisma.user.findUnique({
      where: { email: email.trim().toLowerCase() },
      select: accountView,
    });
    if (!user) throw new AppError('NOT_FOUND', 404, 'User not found');
    return user;
  }

  /** Marks the user banned and ends every session at once. Runs in the caller's transaction. */
  async ban(
    tx: Prisma.TransactionClient,
    userId: string,
    ban: { reason: string; expiresAt: Date | null },
  ) {
    const user = await tx.user.findUnique({ where: { id: userId } });
    if (!user || user.deletedAt) {
      throw new AppError('NOT_FOUND', 404, 'User not found');
    }
    await tx.user.update({
      where: { id: userId },
      data: { banned: true, banReason: ban.reason, banExpires: ban.expiresAt },
    });
    await tx.session.deleteMany({ where: { userId } });
  }

  async unban(userId: string) {
    const { count } = await this.prisma.user.updateMany({
      where: { id: userId },
      data: { banned: false, banReason: null, banExpires: null },
    });
    if (count === 0) throw new AppError('NOT_FOUND', 404, 'User not found');
    return this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: accountView,
    });
  }

  view(userId: string, tx: Prisma.TransactionClient = this.prisma) {
    return tx.user.findUniqueOrThrow({
      where: { id: userId },
      select: accountView,
    });
  }
}
