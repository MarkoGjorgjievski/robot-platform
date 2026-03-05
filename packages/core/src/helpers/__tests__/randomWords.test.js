const { Randomizer } = require('../randomWords.js');
const { wordList } = require('../wordList.js');

describe('Randomizer', () => {
  describe('boxMuller', () => {
    it('returns a number (integer) within the default min/max range', () => {
      const result = Randomizer.boxMuller();
      expect(typeof result).toBe('number');
      expect(Number.isInteger(result)).toBe(true);
      expect(result).toBeGreaterThanOrEqual(Randomizer.minWordCount);
      expect(result).toBeLessThanOrEqual(Randomizer.maxWordCount);
    });

    it('respects custom min and max bounds', () => {
      // Run multiple times to increase confidence
      for (let i = 0; i < 50; i++) {
        const result = Randomizer.boxMuller(1, 5, 1);
        expect(result).toBeGreaterThanOrEqual(1);
        expect(result).toBeLessThanOrEqual(5);
      }
    });
  });

  describe('findRandomInPrefixArray', () => {
    it('finds the correct index via binary search in a sorted cumulative array', () => {
      const arr = [10, 20, 30, 40, 50];
      expect(Randomizer.findRandomInPrefixArray(arr, 15, 0, arr.length - 1)).toBe(1);
      expect(Randomizer.findRandomInPrefixArray(arr, 10, 0, arr.length - 1)).toBe(0);
      expect(Randomizer.findRandomInPrefixArray(arr, 50, 0, arr.length - 1)).toBe(4);
      expect(Randomizer.findRandomInPrefixArray(arr, 1, 0, arr.length - 1)).toBe(0);
      expect(Randomizer.findRandomInPrefixArray(arr, 25, 0, arr.length - 1)).toBe(2);
    });

    it('returns -1 when the random value exceeds all elements', () => {
      const arr = [10, 20, 30];
      expect(Randomizer.findRandomInPrefixArray(arr, 100, 0, arr.length - 1)).toBe(-1);
    });

    it('works with a single-element array', () => {
      expect(Randomizer.findRandomInPrefixArray([5], 3, 0, 0)).toBe(0);
      expect(Randomizer.findRandomInPrefixArray([5], 10, 0, 0)).toBe(-1);
    });
  });

  describe('getWord', () => {
    it('returns an item that exists in the provided array', () => {
      const array = wordList.list;
      const cumul = wordList.cumulFrequency;
      const word = Randomizer.getWord(array, cumul);
      expect(array).toContain(word);
    });

    it('returns a string', () => {
      const word = Randomizer.getWord(wordList.list, wordList.cumulFrequency);
      expect(typeof word).toBe('string');
    });
  });

  describe('generateSlug', () => {
    it('returns a hyphenated string of words from the word list', () => {
      const wordObj = { list: wordList.list, cumulFrequency: wordList.cumulFrequency };
      const slug = Randomizer.generateSlug(wordObj);
      expect(typeof slug).toBe('string');
      expect(slug.length).toBeGreaterThan(0);
      // Slug should contain hyphens (unless only one word, which is unlikely with min=4)
      const parts = slug.split('-');
      expect(parts.length).toBeGreaterThanOrEqual(2);
      // Each part should be a word from the list
      for (const part of parts) {
        expect(wordList.list).toContain(part);
      }
    });

    it('generates slugs of varying length on multiple calls', () => {
      const wordObj = { list: wordList.list, cumulFrequency: wordList.cumulFrequency };
      const slugs = new Set();
      for (let i = 0; i < 10; i++) {
        slugs.add(Randomizer.generateSlug(wordObj));
      }
      // Extremely unlikely that all 10 slugs are identical
      expect(slugs.size).toBeGreaterThan(1);
    });
  });
});
