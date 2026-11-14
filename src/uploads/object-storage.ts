import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { AppError } from '../common/errors/app-error';

/** Where Cover Images live (Cloudflare R2 in production). Tests override it with an in-memory fake. */
export abstract class ObjectStorage {
  /** A short-lived URL the browser PUTs the file to, locked to this type and exact size. */
  abstract signPut(
    key: string,
    contentType: string,
    size: number,
    ttlSeconds: number,
  ): Promise<string>;
  /** The stored object's size, or null if nothing was uploaded. */
  abstract size(key: string): Promise<number | null>;
  abstract read(key: string): Promise<Uint8Array>;
  abstract delete(key: string): Promise<void>;
}

export type R2Config = {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
};

/** Cloudflare R2 through its S3-compatible API. */
export class R2Storage extends ObjectStorage {
  private readonly s3: S3Client;

  constructor(private readonly config: R2Config) {
    super();
    this.s3 = new S3Client({
      region: 'auto',
      endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });
  }

  signPut(key: string, contentType: string, size: number, ttl: number) {
    return getSignedUrl(
      this.s3,
      new PutObjectCommand({
        Bucket: this.config.bucket,
        Key: key,
        ContentType: contentType,
        ContentLength: size,
      }),
      // Signed, so the browser can't send a different type or a bigger file.
      {
        expiresIn: ttl,
        signableHeaders: new Set(['content-type', 'content-length']),
      },
    );
  }

  async size(key: string) {
    try {
      const head = await this.s3.send(
        new HeadObjectCommand({ Bucket: this.config.bucket, Key: key }),
      );
      return head.ContentLength ?? 0;
    } catch (e) {
      if ((e as { name?: string }).name === 'NotFound') return null;
      throw e;
    }
  }

  async read(key: string) {
    const obj = await this.s3.send(
      new GetObjectCommand({ Bucket: this.config.bucket, Key: key }),
    );
    return obj.Body!.transformToByteArray();
  }

  async delete(key: string) {
    await this.s3.send(
      new DeleteObjectCommand({ Bucket: this.config.bucket, Key: key }),
    );
  }
}

/** No R2 settings (local development): the app runs, uploading says it's unavailable. */
export class UnconfiguredStorage extends ObjectStorage {
  private fail(): never {
    throw new AppError(
      'UPLOADS_UNAVAILABLE',
      503,
      'Image uploads are not configured on this server',
    );
  }
  signPut(): Promise<string> {
    this.fail();
  }
  size(): Promise<number | null> {
    this.fail();
  }
  read(): Promise<Uint8Array> {
    this.fail();
  }
  delete(): Promise<void> {
    return Promise.resolve();
  }
}

const R2_VARS = [
  'R2_ACCOUNT_ID',
  'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY',
  'R2_BUCKET',
  'R2_PUBLIC_URL',
] as const;

/** R2 when configured, unavailable otherwise. A partial config fails at startup. */
export function storageFromEnv(env: NodeJS.ProcessEnv): ObjectStorage {
  const set = R2_VARS.filter((k) => env[k]?.trim());
  if (set.length === 0) return new UnconfiguredStorage();
  const missing = R2_VARS.filter((k) => !env[k]?.trim());
  if (missing.length > 0) {
    throw new Error(
      `R2 is partly configured (${set.join(', ')} set); also set ${missing.join(', ')}, or unset them all`,
    );
  }
  return new R2Storage({
    accountId: env.R2_ACCOUNT_ID!.trim(),
    accessKeyId: env.R2_ACCESS_KEY_ID!.trim(),
    secretAccessKey: env.R2_SECRET_ACCESS_KEY!.trim(),
    bucket: env.R2_BUCKET!.trim(),
  });
}

/** The public address of a stored Cover Image (R2_PUBLIC_URL: the bucket's custom domain). */
export function coverImageUrl(key: string | null): string | null {
  const base = process.env.R2_PUBLIC_URL?.trim().replace(/\/+$/, '');
  return key && base ? `${base}/${key}` : null;
}
