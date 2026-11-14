/**
 * Public, identical-for-everyone responses: shared caches (Cloudflare) keep them 60s, while
 * browsers always revalidate, so a user who just joined never sees their own stale page.
 */
export const PUBLIC_CACHE = 'public, max-age=0, s-maxage=60';

/** Personal responses (may contain online links or private data): never stored anywhere. */
export const NO_STORE = 'no-store';
