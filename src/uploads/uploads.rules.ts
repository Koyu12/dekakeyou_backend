// Pure decisions for Cover Image uploads (ADR-0003): no Prisma, no Nest.

export const COVER_MAX_BYTES = 5 * 1024 * 1024;
export const COVER_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type CoverType = (typeof COVER_TYPES)[number];
export const UPLOAD_URL_TTL_SECONDS = 10 * 60;
/** Requests for signed URLs per user per hour (each URL can create one object). */
export const UPLOADS_PER_HOUR = 20;

const EXT: Record<CoverType, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

/** The storage key; its extension records the declared type. Never contains the user id. */
export function coverKey(uploadId: string, type: CoverType) {
  return `covers/${uploadId}.${EXT[type]}`;
}

export function typeOfKey(key: string): CoverType | null {
  const ext = key.split('.').pop();
  return COVER_TYPES.find((t) => EXT[t] === ext) ?? null;
}

/** The real type, from the file's first bytes (the declared Content-Type is the client's word). */
export function sniffImageType(bytes: Uint8Array): CoverType | null {
  const starts = (sig: number[], at = 0) =>
    sig.every((b, i) => bytes[at + i] === b);
  if (starts([0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    return 'image/png';
  if (starts([0x52, 0x49, 0x46, 0x46]) && starts([0x57, 0x45, 0x42, 0x50], 8))
    return 'image/webp';
  return null;
}

/** Why an uploaded file can't be a Cover Image, or null if its size and type are fine. */
export function fileProblem(
  declared: CoverType | null,
  size: number,
  head: Uint8Array,
): string | null {
  if (size === 0) return 'The file is empty';
  if (size > COVER_MAX_BYTES) return 'The image is larger than 5 MB';
  const actual = sniffImageType(head);
  if (!actual) return 'The file is not a JPEG, PNG or WebP image';
  if (actual !== declared) return `The file is a ${actual}, not ${declared}`;
  return null;
}
