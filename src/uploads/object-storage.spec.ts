import {
  coverImageUrl,
  S3Storage,
  storageFromEnv,
  UnconfiguredStorage,
} from './object-storage';

describe('storageFromEnv', () => {
  const full = {
    STORAGE_ENDPOINT: 'https://ref.storage.supabase.co/storage/v1/s3',
    STORAGE_REGION: 'ap-southeast-1',
    STORAGE_ACCESS_KEY_ID: 'key',
    STORAGE_SECRET_ACCESS_KEY: 'secret',
    STORAGE_BUCKET: 'covers',
    STORAGE_PUBLIC_URL: 'https://img.example.com',
  };

  it('nothing set → uploads unavailable (the app still runs)', async () => {
    const storage = storageFromEnv({});
    expect(storage).toBeInstanceOf(UnconfiguredStorage);
    await expect(
      Promise.resolve().then(() => storage.signPut('k', 'image/png', 1, 60)),
    ).rejects.toMatchObject({ code: 'UPLOADS_UNAVAILABLE', status: 503 });
  });

  it('all set → S3 storage; partly set → a clear error at startup', () => {
    expect(storageFromEnv(full)).toBeInstanceOf(S3Storage);
    expect(() => storageFromEnv({ ...full, STORAGE_BUCKET: '' })).toThrow(
      /also set STORAGE_BUCKET/,
    );
  });

  it('builds public URLs from STORAGE_PUBLIC_URL', () => {
    process.env.STORAGE_PUBLIC_URL = 'https://img.example.com/';
    expect(coverImageUrl('covers/a.png')).toBe(
      'https://img.example.com/covers/a.png',
    );
    expect(coverImageUrl(null)).toBeNull();
    delete process.env.STORAGE_PUBLIC_URL;
  });
});
