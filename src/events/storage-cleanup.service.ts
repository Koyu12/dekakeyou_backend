import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Notifier } from '../notifications/notifier';
import { PrismaService } from '../prisma/prisma.service';
import { UploadsService } from '../uploads/uploads.service';

export const CLEANUP_QUEUE = 'storage-cleanup';
const DAY_MS = 24 * 60 * 60 * 1000;
/** A Removed Event keeps its Cover Image this long (for appeals), then the file goes. */
export const REMOVED_COVER_DAYS = 30;

/**
 * Daily: Removed Events past 30 days drop their Cover Image, then every Upload no Event uses
 * (older than the grace period) is deleted from storage and the database. Safe to run twice.
 */
@Injectable()
export class StorageCleanupService implements OnModuleInit {
  private readonly logger = new Logger(StorageCleanupService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly uploads: UploadsService,
    private readonly notifier: Notifier, // owns the app's one pg-boss instance
  ) {}

  async onModuleInit() {
    const { boss } = this.notifier;
    await boss.createQueue(CLEANUP_QUEUE);
    await boss.schedule(CLEANUP_QUEUE, '15 3 * * *', null, { missed: 'once' });
    await boss.work(CLEANUP_QUEUE, () => this.run());
  }

  async run() {
    const { count: covers } = await this.prisma.event.updateMany({
      where: {
        status: 'REMOVED',
        removedAt: { lt: new Date(Date.now() - REMOVED_COVER_DAYS * DAY_MS) },
        coverImageKey: { not: null },
      },
      data: { coverImageKey: null },
    });
    const uploads = await this.uploads.purgeUnattached(); // includes the covers just dropped
    this.logger.log(
      `Cleanup: ${covers} Removed Cover Images, ${uploads} Uploads deleted`,
    );
    return { covers, uploads };
  }
}
