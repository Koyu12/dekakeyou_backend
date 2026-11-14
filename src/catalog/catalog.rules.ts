// Pure decisions about the catalog (ADR-0003): no Prisma, no Nest.

export const MAX_TAGS_PER_EVENT = 5;
export const MAX_TAG_LENGTH = 30;

/**
 * One canonical spelling per Tag: "  #Genshin Impact " → "genshin-impact".
 * NFKC folds full-width forms (Ｃｏｓｐｌａｙ → cosplay); letters of any script are kept (コスプレ).
 * Returns null when nothing valid is left.
 */
export function normalizeTag(raw: string): string | null {
  const tag = raw
    .normalize('NFKC')
    .trim()
    .replace(/^#+/, '')
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  if (!tag || tag.length > MAX_TAG_LENGTH) return null;
  return /^[\p{L}\p{N}-]+$/u.test(tag) ? tag : null;
}

/** Normalizes and de-duplicates an Event's Tags, or explains why they're not acceptable. */
export function normalizeTags(
  raw: string[],
): { tags: string[] } | { error: string } {
  const tags: string[] = [];
  for (const r of raw) {
    const tag = normalizeTag(r);
    if (!tag) {
      return {
        error: `"${r}" isn't a valid Tag (letters, numbers and dashes, up to ${MAX_TAG_LENGTH})`,
      };
    }
    if (!tags.includes(tag)) tags.push(tag);
  }
  if (tags.length > MAX_TAGS_PER_EVENT) {
    return { error: `An Event can have at most ${MAX_TAGS_PER_EVENT} Tags` };
  }
  return { tags };
}

/**
 * Why the Admin can't delete a Category or City, or null. Archiving is always allowed: it is
 * how an entry that Events still use is retired.
 */
export function deleteRefusal(usedByEvents: number): string | null {
  if (usedByEvents === 0) return null;
  return `Used by ${usedByEvents} Event${usedByEvents === 1 ? '' : 's'}; archive it instead`;
}
