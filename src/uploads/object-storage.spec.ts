import {
  coverImageUrl,
  R2Storage,
  storageFromEnv,
  UnconfiguredStorage,
} from './object-storage';

describe('storageFromEnv', () => {
  const full = {
    R2_ACCOUNT_ID: 'acc',
    R2_ACCESS_KEY_ID: 'key',
    R2_SECRET_ACCESS_KEY: 'secret',
    R2_BUCKET: 'covers',
    R2_PUBLIC_URL: 'https://img.example.com',
  };

  it('nothing set → uploads unavailable (the app still runs)', async () => {
    const storage = storageFromEnv({});
    expect(storage).toBeInstanceOf(UnconfiguredStorage);
    await expect(
      Promise.resolve().then(() => storage.signPut('k', 'image/png', 1, 60)),
    ).rejects.toMatchObject({ code: 'UPLOADS_UNAVAILABLE', status: 503 });
  });

  it('all set → R2; partly set → a clear error at startup', () => {
    expect(storageFromEnv(full)).toBeInstanceOf(R2Storage);
    expect(() => storageFromEnv({ ...full, R2_BUCKET: '' })).toThrow(
      /also set R2_BUCKET/,
    );
  });

  it('builds public URLs from R2_PUBLIC_URL', () => {
    process.env.R2_PUBLIC_URL = 'https://img.example.com/';
    expect(coverImageUrl('covers/a.png')).toBe(
      'https://img.example.com/covers/a.png',
    );
    expect(coverImageUrl(null)).toBeNull();
    delete process.env.R2_PUBLIC_URL;
  });
});
