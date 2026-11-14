import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AppError } from '../common/errors/app-error';
import { ContentCheckService } from '../content-check/content-check.service';
import type { Prisma, Upload } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { coverImageUrl, ObjectStorage } from './object-storage';
import {
  COVER_MAX_BYTES,
  coverKey,
  CoverType,
  fileProblem,
  typeOfKey,
  UPLOAD_GRACE_MS,
  UPLOAD_URL_TTL_SECONDS,
  UPLOADS_PER_HOUR,
} from './uploads.rules';
import type { UploadTicket, UploadView } from './uploads.schemas';

const HOUR_MS = 60 * 60 * 1000;

// The Upload lifecycle: Pending (URL handed out) → Approved or Rejected (after the image check).
@Injectable()
export class UploadsService {
  private readonly logger = new Logger(UploadsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: ObjectStorage,
    private readonly contentCheck: ContentCheckService,
  ) {}

  async request(
    userId: string,
    input: { contentType: CoverType; size: number },
  ): Promise<UploadTicket> {
    const recent = await this.prisma.upload.count({
      where: {
        uploaderId: userId,
        createdAt: { gte: new Date(Date.now() - HOUR_MS) },
      },
    });
    if (recent >= UPLOADS_PER_HOUR) {
      throw new AppError(
        'RATE_LIMITED',
        429,
        `You can upload at most ${UPLOADS_PER_HOUR} images per hour`,
      );
    }
    const id = randomUUID();
    const key = coverKey(id, input.contentType);
    const uploadUrl = await this.storage.signPut(
      key,
      input.contentType,
      input.size,
      UPLOAD_URL_TTL_SECONDS,
    );
    await this.prisma.upload.create({
      data: { id, storageKey: key, uploaderId: userId },
    });
    return {
      id,
      uploadUrl,
      method: 'PUT',
      headers: {
        'Content-Type': input.contentType,
        'Content-Length': String(input.size),
      },
      expiresAt: new Date(
        Date.now() + UPLOAD_URL_TTL_SECONDS * 1000,
      ).toISOString(),
    };
  }

  /** After the browser uploaded the file: checks it and decides Approved or Rejected. */
  async verify(userId: string, id: string): Promise<UploadView> {
    const upload = await this.findOwn(userId, id);
    if (upload.status !== 'PENDING') return toView(upload); // already decided

    const key = upload.storageKey;
    const size = await this.storage.size(key);
    if (size === null) {
      throw new AppError(
        'UPLOAD_NOT_READY',
        409,
        'Upload the file to the signed URL first',
      );
    }
    const bytes =
      size > 0 && size <= COVER_MAX_BYTES
        ? await this.storage.read(key)
        : new Uint8Array();
    const declared = typeOfKey(key);
    let reason = fileProblem(declared, size, bytes.subarray(0, 16));
    let needsReview = false;
    if (!reason) {
      const verdict = await this.contentCheck.checkImage({
        bytes: Buffer.from(bytes),
        contentType: declared!,
      });
      if (verdict.result === 'FAIL') reason = verdict.reason;
      needsReview = verdict.result === 'BORDERLINE';
    }

    if (reason) {
      // A rejected file is never served; drop it now rather than at cleanup.
      await this.storage
        .delete(key)
        .catch((e: unknown) =>
          this.logger.warn(`Could not delete rejected ${key}: ${String(e)}`),
        );
    }
    // Only a still-Pending row changes, so two verify calls can't disagree.
    await this.prisma.upload.updateMany({
      where: { id, status: 'PENDING' },
      data: reason
        ? { status: 'REJECTED', rejectedReason: reason }
        : { status: 'APPROVED', needsReview },
    });
    return toView(
      await this.prisma.upload.findUniqueOrThrow({ where: { id } }),
    );
  }

  async get(userId: string, id: string): Promise<UploadView> {
    return toView(await this.findOwn(userId, id));
  }

  /**
   * Called by events when attaching a Cover Image, in its transaction: only the user's own
   * Approved Upload, not already used by another Event. Returns the key to store.
   */
  async claimCover(
    tx: Prisma.TransactionClient,
    userId: string,
    uploadId: string,
    eventId?: string,
  ): Promise<{ key: string; needsReview: boolean }> {
    const upload = await tx.upload.findUnique({ where: { id: uploadId } });
    const unusable = (why: string) =>
      new AppError('UPLOAD_NOT_USABLE', 422, why);
    if (!upload || upload.uploaderId !== userId) {
      throw unusable('Cover Image must be one of your own uploads');
    }
    if (upload.status === 'PENDING') {
      throw unusable('Verify the upload before attaching it');
    }
    if (upload.status === 'REJECTED') {
      throw unusable(`This image was rejected: ${upload.rejectedReason}`);
    }
    const usedElsewhere = await tx.event.count({
      where: {
        coverImageKey: upload.storageKey,
        ...(eventId ? { NOT: { id: eventId } } : {}),
      },
    });
    if (usedElsewhere > 0) {
      throw unusable('This image is already the Cover Image of another Event');
    }
    return { key: upload.storageKey, needsReview: upload.needsReview };
  }

  /**
   * Deletes Uploads no Event uses (Pending, Rejected, replaced or never attached) once they are
   * older than the grace period. Rows go first, so a file is never deleted while still attached;
   * running it twice finds nothing the second time.
   */
  async purgeUnattached(graceMs = UPLOAD_GRACE_MS): Promise<number> {
    const cutoff = new Date(Date.now() - graceMs);
    // shortcut: an attach committing in the same instant as this delete can lose its file; fine at daily runs on day-old Uploads.
    const gone = await this.prisma.$queryRaw<{ storageKey: string }[]>`
      DELETE FROM "Upload" u
      WHERE u."createdAt" < ${cutoff}
        AND NOT EXISTS (SELECT 1 FROM "Event" e WHERE e."coverImageKey" = u."storageKey")
      RETURNING u."storageKey"`;
    for (const { storageKey } of gone) {
      // A file left behind costs a few KB; a crash here must not undo the run.
      await this.storage
        .delete(storageKey)
        .catch((e: unknown) =>
          this.logger.warn(`Could not delete ${storageKey}: ${String(e)}`),
        );
    }
    return gone.length;
  }

  private async findOwn(userId: string, id: string) {
    const upload = await this.prisma.upload.findUnique({ where: { id } });
    if (!upload || upload.uploaderId !== userId) {
      throw new AppError('UPLOAD_NOT_FOUND', 404, 'Upload not found');
    }
    return upload;
  }
}

function toView(u: Upload): UploadView {
  return {
    id: u.id,
    status: u.status,
    rejectedReason: u.rejectedReason,
    url: u.status === 'APPROVED' ? coverImageUrl(u.storageKey) : null,
  };
}
