import {
  COVER_MAX_BYTES,
  coverKey,
  fileProblem,
  sniffImageType,
  typeOfKey,
} from './uploads.rules';

const png = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0,
]);
const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]);
const webp = Uint8Array.from([
  0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50,
]);
const html = new TextEncoder().encode('<html><script>alert(1)</script>');

describe('uploads rules', () => {
  it('detects the real image type from the first bytes', () => {
    expect(sniffImageType(png)).toBe('image/png');
    expect(sniffImageType(jpeg)).toBe('image/jpeg');
    expect(sniffImageType(webp)).toBe('image/webp');
    expect(sniffImageType(html)).toBeNull();
  });

  it('keys carry the type but not the user', () => {
    expect(coverKey('abc', 'image/webp')).toBe('covers/abc.webp');
    expect(typeOfKey('covers/abc.jpg')).toBe('image/jpeg');
    expect(typeOfKey('covers/abc.exe')).toBeNull();
  });

  it.each([
    ['ok', 'image/png', 9, png, null],
    ['empty', 'image/png', 0, png, 'The file is empty'],
    ['too big', 'image/png', COVER_MAX_BYTES + 1, png, /larger than 5 MB/],
    ['not an image', 'image/png', 30, html, /not a JPEG, PNG or WebP/],
    ['type mismatch', 'image/jpeg', 9, png, /image\/png, not image\/jpeg/],
  ] as const)('fileProblem: %s', (_, declared, size, head, expected) => {
    const problem = fileProblem(declared, size, head);
    if (expected === null) expect(problem).toBeNull();
    else expect(problem).toMatch(expected);
  });
});
