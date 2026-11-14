import { findBannedWord, verdictFromScores } from './content-check.rules';

describe('findBannedWord', () => {
  const words = ['porn', 'bokep', 'ポルノ'];

  it.each([
    'Free porn here',
    'FREE PORN',
    'Ｐｏｒｎ party', // full-width
    'p o r n',
    'p.o.r.n',
    'p-o_r*n',
    'porno night', // the word as a prefix still matches
    'Nonton BOKEP bareng',
    'b o k e p',
    'ポルノ上映会', // no spaces in Japanese
  ])('finds a banned word in %p', (text) => {
    expect(findBannedWord(text, words)).not.toBeNull();
  });

  it.each(['Cosplay photo walk', 'Anime watch party', 'コスプレ撮影会'])(
    'passes clean text %p',
    (text) => {
      expect(findBannedWord(text, words)).toBeNull();
    },
  );

  it('matches word starts on purpose, accepting rare false positives like names', () => {
    // Catches "porno", "pornhub"…; a name like "Pornpimol" is rejected too, and can be fixed by an Admin.
    expect(findBannedWord('Pornpimol Thai cooking', words)).toBe('porn');
  });

  it('does not match inside another word', () => {
    expect(findBannedWord('spornosaurus', words)).toBeNull();
    expect(findBannedWord('my-bokepian', ['kep'])).toBeNull();
  });

  it('returns the matched list entry', () => {
    expect(findBannedWord('nonton bokep', words)).toBe('bokep');
  });
});

describe('verdictFromScores', () => {
  it('passes low scores', () => {
    expect(verdictFromScores({ sexual: 0.1, violence: 0.05 })).toEqual({
      result: 'PASS',
    });
  });

  it('holds the middle band for review, naming the worst category', () => {
    expect(verdictFromScores({ sexual: 0.5, violence: 0.1 })).toEqual({
      result: 'BORDERLINE',
      reason: 'Possibly sexual; held for review',
    });
  });

  it('fails high scores', () => {
    expect(verdictFromScores({ harassment: 0.95 })).toEqual({
      result: 'FAIL',
      reason: 'Content flagged as harassment',
    });
  });

  it('treats an empty score map as a pass', () => {
    expect(verdictFromScores({})).toEqual({ result: 'PASS' });
  });
});
