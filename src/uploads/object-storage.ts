import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { AppError } from '../common/errors/app-error';

/** Where Cover Images live (an S3-compatible store in production). Tests override it with an in-memory fake. */
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

export type S3Config = {
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
};

/** Any S3-compatible store: Supabase Storage in production, also Cloudflare R2, AWS S3, MinIO… */
export class S3Storage extends ObjectStorage {
  private readonly s3: S3Client;

  constructor(private readonly config: S3Config) {
    super();
    this.s3 = new S3Client({
      region: config.region,
      endpoint: config.endpoint,
      forcePathStyle: true, // Supabase requires it; R2 and MinIO accept it
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

/** No storage settings (local development): the app runs, uploading says it's unavailable. */
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

const STORAGE_VARS = [
  'STORAGE_ENDPOINT',
  'STORAGE_REGION',
  'STORAGE_ACCESS_KEY_ID',
  'STORAGE_SECRET_ACCESS_KEY',
  'STORAGE_BUCKET',
  'STORAGE_PUBLIC_URL',
] as const;

/** S3 storage when configured, unavailable otherwise. A partial config fails at startup. */
export function storageFromEnv(env: NodeJS.ProcessEnv): ObjectStorage {
  const set = STORAGE_VARS.filter((k) => env[k]?.trim());
  if (set.length === 0) return new UnconfiguredStorage();
  const missing = STORAGE_VARS.filter((k) => !env[k]?.trim());
  if (missing.length > 0) {
    throw new Error(
      `Storage is partly configured (${set.join(', ')} set); also set ${missing.join(', ')}, or unset them all`,
    );
  }
  return new S3Storage({
    endpoint: env.STORAGE_ENDPOINT!.trim(),
    region: env.STORAGE_REGION!.trim(),
    accessKeyId: env.STORAGE_ACCESS_KEY_ID!.trim(),
    secretAccessKey: env.STORAGE_SECRET_ACCESS_KEY!.trim(),
    bucket: env.STORAGE_BUCKET!.trim(),
  });
}

/** The public address of a stored Cover Image (STORAGE_PUBLIC_URL: where the bucket is served). */
export function coverImageUrl(key: string | null): string | null {
  const base = process.env.STORAGE_PUBLIC_URL?.trim().replace(/\/+$/, '');
  return key && base ? `${base}/${key}` : null;
}
