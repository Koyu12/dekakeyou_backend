// Pure decisions for the automatic content check (ADR-0003): no Prisma, no Nest.

export type Verdict =
  | { result: 'PASS' }
  | { result: 'BORDERLINE'; reason: string }
  | { result: 'FAIL'; reason: string };

/** Lowercase, width-folded text, so "ＰＯＲＮ" and "Porn" compare equal. */
function fold(text: string) {
  return text.normalize('NFKC').toLowerCase();
}

const isLatinWord = (word: string) => /^[\p{Script=Latin}\d]+$/u.test(word);

/**
 * Builds a matcher for one banned word.
 * Latin words: letters may be split by spaces or symbols ("p o r n", "p.o.r.n"), and the word
 * must start at a word boundary, so "scunthorpe"-style substrings in other words don't match.
 * Other scripts (e.g. Japanese, written without spaces): plain substring match.
 */
function matcher(word: string): RegExp {
  const w = fold(word);
  if (!isLatinWord(w)) {
    return new RegExp(w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'u');
  }
  const spaced = [...w].join('[^\\p{L}\\p{N}]*');
  return new RegExp(`(?<![\\p{L}\\p{N}])${spaced}`, 'u');
}

/** The first banned word found in the text, or null. */
export function findBannedWord(
  text: string,
  bannedWords: readonly string[],
): string | null {
  const folded = fold(text);
  for (const word of bannedWords) {
    if (matcher(word).test(folded)) return word;
  }
  return null;
}

// Thresholds for an AI moderation score (0..1, highest category). Tune them in #22.
export const FAIL_SCORE = 0.8;
export const BORDERLINE_SCORE = 0.4;

/** Turns per-category scores from an AI moderation API into a Verdict. */
export function verdictFromScores(scores: Record<string, number>): Verdict {
  let worst = { category: '', score: 0 };
  for (const [category, score] of Object.entries(scores)) {
    if (score > worst.score) worst = { category, score };
  }
  if (worst.score >= FAIL_SCORE) {
    return { result: 'FAIL', reason: `Content flagged as ${worst.category}` };
  }
  if (worst.score >= BORDERLINE_SCORE) {
    return {
      result: 'BORDERLINE',
      reason: `Possibly ${worst.category}; held for review`,
    };
  }
  return { result: 'PASS' };
}
