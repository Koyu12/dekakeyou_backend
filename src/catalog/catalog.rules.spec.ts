import { normalizeTag, normalizeTags } from './catalog.rules';

describe('normalizeTag', () => {
  it.each([
    ['Cosplay ', 'cosplay'],
    ['cosplay', 'cosplay'],
    ['COSPLAY', 'cosplay'],
    ['  #Genshin Impact ', 'genshin-impact'],
    ['genshin_impact', 'genshin-impact'],
    ['genshin--impact', 'genshin-impact'],
    ['Ｃｏｓｐｌａｙ', 'cosplay'], // full-width
    ['コスプレ', 'コスプレ'],
    ['J-Music', 'j-music'],
    ['vtuber2027', 'vtuber2027'],
  ])('%p → %p', (raw, expected) => {
    expect(normalizeTag(raw)).toBe(expected);
  });

  it.each(['', '   ', '#', '---', 'c++', 'a/b', '<script>', 'x'.repeat(31)])(
    'rejects %p',
    (raw) => {
      expect(normalizeTag(raw)).toBeNull();
    },
  );
});

describe('normalizeTags', () => {
  it('normalizes and removes duplicates, keeping first-seen order', () => {
    expect(normalizeTags(['Cosplay ', 'cosplay', 'COSPLAY', 'Anime'])).toEqual({
      tags: ['cosplay', 'anime'],
    });
  });

  it('accepts up to 5 distinct Tags', () => {
    expect(normalizeTags(['a', 'b', 'c', 'd', 'e'])).toEqual({
      tags: ['a', 'b', 'c', 'd', 'e'],
    });
  });

  it('rejects more than 5 distinct Tags', () => {
    const result = normalizeTags(['a', 'b', 'c', 'd', 'e', 'f']);
    expect('error' in result && result.error).toMatch(/at most 5/);
  });

  it('counts duplicates once toward the limit', () => {
    expect(normalizeTags(['a', 'A', 'b', 'c', 'd', 'e'])).toEqual({
      tags: ['a', 'b', 'c', 'd', 'e'],
    });
  });

  it('rejects an invalid Tag with the original spelling in the message', () => {
    const result = normalizeTags(['ok', 'c++']);
    expect('error' in result && result.error).toContain('"c++"');
  });
});
