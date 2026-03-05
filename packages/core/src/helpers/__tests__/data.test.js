const { DataModifier } = require('../data');

// Helper to build a data structure matching the expected shape:
// data = [{ group: [ { fieldName: [{ text, xpath?, ... }] } ] }]
function makeData(groups) {
  return groups.map(rows => ({
    group: rows.map(row =>
      Object.fromEntries(
        Object.entries(row).map(([key, values]) => [
          key,
          values.map(v => (typeof v === 'string' ? { text: v, xpath: `//${key}` } : v)),
        ]),
      ),
    ),
  }));
}

describe('DataModifier', () => {
  // ─── nbCollected ───────────────────────────────────────────────

  describe('nbCollected', () => {
    it('returns 0 for empty data', () => {
      expect(DataModifier.nbCollected([])).toBe(0);
    });

    it('counts rows in a single group', () => {
      const data = [{ group: [{ a: 1 }, { b: 2 }, { c: 3 }] }];
      expect(DataModifier.nbCollected(data)).toBe(3);
    });

    it('sums rows across multiple groups', () => {
      const data = [
        { group: [{ a: 1 }, { b: 2 }] },
        { group: [{ c: 3 }] },
        { group: [{ d: 4 }, { e: 5 }, { f: 6 }] },
      ];
      expect(DataModifier.nbCollected(data)).toBe(6);
    });
  });

  // ─── nbCollectedUnique ─────────────────────────────────────────

  describe('nbCollectedUnique', () => {
    it('returns count of unique extracted field values', () => {
      const data = makeData([
        [
          { url: ['https://a.com'] },
          { url: ['https://b.com'] },
          { url: ['https://a.com'] }, // duplicate
        ],
      ]);
      expect(DataModifier.nbCollectedUnique(data, 'url')).toBe(2);
    });
  });

  // ─── filterConditions ──────────────────────────────────────────

  describe('filterConditions', () => {
    it('returns falsy for null/undefined', () => {
      expect(DataModifier.filterConditions(null)).toBeFalsy();
      expect(DataModifier.filterConditions(undefined)).toBeFalsy();
    });

    it('returns false when text is "null"', () => {
      expect(DataModifier.filterConditions({ text: 'null', xpath: '//a' })).toBe(false);
    });

    it('returns true for object with text and no xpath requirement', () => {
      expect(DataModifier.filterConditions({ text: 'hello' }, false)).toBe(true);
    });

    it('returns false when needXpath is true but xpath is missing', () => {
      expect(DataModifier.filterConditions({ text: 'hello' }, true)).toBe(false);
    });

    it('returns true when needXpath is true and xpath exists', () => {
      expect(DataModifier.filterConditions({ text: 'hello', xpath: '//div' }, true)).toBe(true);
    });

    it('handles arrays by checking if any element passes', () => {
      const arr = [{ text: 'null' }, { text: 'valid', xpath: '//a' }];
      expect(DataModifier.filterConditions(arr, true)).toBe(true);
    });

    it('returns false for array where no element passes', () => {
      const arr = [{ text: 'null' }, null];
      expect(DataModifier.filterConditions(arr, false)).toBe(false);
    });
  });

  // ─── extractFieldasArray ───────────────────────────────────────

  describe('extractFieldasArray', () => {
    it('returns empty array when fieldName is not provided', () => {
      const data = makeData([[{ url: ['https://a.com'] }]]);
      const result = DataModifier.extractFieldasArray(data, null);
      expect(result).toEqual([]);
    });

    it('extracts unique field values as key-value pairs', () => {
      const data = makeData([
        [
          { link: ['https://a.com'], name: ['Alice'] },
          { link: ['https://b.com'], name: ['Bob'] },
        ],
      ]);
      const result = DataModifier.extractFieldasArray(data, { nextDepthURLFieldName: 'link', markToRemove: false });
      expect(result).toHaveLength(2);
      expect(result.map(r => r.key)).toEqual(['https://a.com', 'https://b.com']);
    });

    it('prepends domain when prependDomain is specified', () => {
      const data = makeData([[{ path: ['/page1'] }]]);
      const result = DataModifier.extractFieldasArray(
        data,
        { nextDepthURLFieldName: 'path', markToRemove: false },
        { prependDomain: 'https://example.com' },
      );
      expect(result[0].key).toBe('https://example.com/page1');
    });

    it('removes field when removeField is true', () => {
      const data = makeData([[{ link: ['https://a.com'], name: ['Alice'] }]]);
      DataModifier.extractFieldasArray(
        data,
        { nextDepthURLFieldName: 'link', markToRemove: false },
        { removeField: true },
      );
      // After removeField, the 'link' field should be gone from the row
      expect(data[0].group[0]).not.toHaveProperty('link');
      expect(data[0].group[0]).toHaveProperty('name');
    });
  });

  // ─── markToRemove ──────────────────────────────────────────────

  describe('markToRemove', () => {
    it('marks all field values with willBeRemovedInTransform when markToRemove is true', () => {
      const data = makeData([[{ name: ['Alice'], age: ['30'] }]]);
      DataModifier.markToRemove(data, 'name', true);
      // Every value in every field of the row should be marked
      for (const val of data[0].group[0].name) {
        expect(val.willBeRemovedInTransform).toBe(true);
      }
      for (const val of data[0].group[0].age) {
        expect(val.willBeRemovedInTransform).toBe(true);
      }
    });

    it('only marks rows where field has xpath in ONLY_IF_FOUND mode', () => {
      const data = [
        {
          group: [
            {
              link: [{ text: 'https://a.com', xpath: '//a' }],
              name: [{ text: 'Alice', xpath: '//span' }],
            },
            {
              link: [{ text: 'no-xpath' }], // no xpath
              name: [{ text: 'Bob', xpath: '//span' }],
            },
          ],
        },
      ];
      DataModifier.markToRemove(data, 'link', 'ONLY_IF_FOUND');
      // First row should be marked (link has xpath)
      expect(data[0].group[0].name[0].willBeRemovedInTransform).toBe(true);
      // Second row should NOT be marked (link has no xpath)
      expect(data[0].group[1].name[0].willBeRemovedInTransform).toBeUndefined();
    });
  });

  // ─── removeFields ──────────────────────────────────────────────

  describe('removeFields', () => {
    it('removes a specific field by name from all rows', () => {
      const data = makeData([[{ link: ['a'], name: ['Alice'] }, { link: ['b'], name: ['Bob'] }]]);
      DataModifier.removeFields(data, 'link');
      for (const row of data[0].group) {
        expect(row).not.toHaveProperty('link');
        expect(row).toHaveProperty('name');
      }
    });

    it('removes marked fields when fieldName is falsy', () => {
      const data = [
        {
          group: [
            {
              kept: [{ text: 'keep', willBeRemovedInTransform: false }],
              removed: [{ text: 'bye', willBeRemovedInTransform: true }],
            },
          ],
        },
      ];
      const result = DataModifier.removeFields(data, null);
      expect(result[0].group[0]).not.toHaveProperty('removed');
      expect(result[0].group[0]).toHaveProperty('kept');
    });

    it('filters out empty groups after removal', () => {
      const data = [
        {
          group: [
            { onlyField: [{ text: 'val', xpath: '//x' }] },
          ],
        },
      ];
      const result = DataModifier.removeFields(data, 'onlyField');
      // Group becomes empty after removing the only field, so the whole entry is filtered out
      expect(result).toHaveLength(0);
    });
  });

  // ─── addFileFields ─────────────────────────────────────────────

  describe('addFileFields', () => {
    it('adds _genFile suffix for fields containing downloadable items', () => {
      const data = [
        {
          group: [
            {
              doc: [
                { text: 'file1.pdf', linkToDownload: 'https://cdn/file1.pdf' },
                { text: 'regular text' },
              ],
            },
          ],
        },
      ];
      const result = DataModifier.addFileFields(data);
      expect(result[0].group[0]).toHaveProperty('doc_genFile');
      expect(result[0].group[0].doc_genFile).toHaveLength(1);
      expect(result[0].group[0].doc_genFile[0].linkToDownload).toBe('https://cdn/file1.pdf');
    });

    it('adds _genFile for fields with type "file"', () => {
      const data = [
        {
          group: [
            {
              attachment: [{ text: 'img.png', type: 'File' }],
            },
          ],
        },
      ];
      const result = DataModifier.addFileFields(data);
      expect(result[0].group[0]).toHaveProperty('attachment_genFile');
      expect(result[0].group[0].attachment_genFile).toHaveLength(1);
    });

    it('does not create _genFile for fields without download/file values', () => {
      const data = [
        {
          group: [
            {
              title: [{ text: 'Hello World' }],
            },
          ],
        },
      ];
      const result = DataModifier.addFileFields(data);
      expect(result[0].group[0]).not.toHaveProperty('title_genFile');
    });

    it('does not duplicate if _genFile already exists', () => {
      const data = [
        {
          group: [
            {
              doc_genFile: [{ text: 'already', linkToDownload: 'url' }],
            },
          ],
        },
      ];
      const result = DataModifier.addFileFields(data);
      // Should not create doc_genFile_genFile
      expect(result[0].group[0]).not.toHaveProperty('doc_genFile_genFile');
    });
  });

  // ─── getReducedData ────────────────────────────────────────────

  describe('getReducedData', () => {
    it('merges rows matching the key and deduplicates values', () => {
      const data = [
        {
          group: [
            {
              link: [{ text: 'https://a.com', xpath: '//a' }],
              name: [{ text: 'Alice', xpath: '//span' }],
            },
            {
              link: [{ text: 'https://a.com', xpath: '//a' }],
              name: [{ text: 'Alice', xpath: '//span' }], // duplicate
            },
            {
              link: [{ text: 'https://b.com', xpath: '//a' }],
              name: [{ text: 'Bob', xpath: '//span' }],
            },
          ],
        },
      ];
      const result = DataModifier.getReducedData(data, 'https://a.com', 'link');
      // Should have merged the two rows for 'https://a.com'
      expect(result).toHaveProperty('link');
      expect(result).toHaveProperty('name');
      // The name 'Alice' appears in both rows but should be deduplicated
      // Since there's only one unique value, getReducedData reduces singletons
      expect(result.name).toEqual({ text: 'Alice' });
    });

    it('returns empty object when no rows match the key', () => {
      const data = [
        {
          group: [
            {
              link: [{ text: 'https://a.com', xpath: '//a' }],
              name: [{ text: 'Alice', xpath: '//span' }],
            },
          ],
        },
      ];
      const result = DataModifier.getReducedData(data, 'https://nonexistent.com', 'link');
      expect(result).toEqual({});
    });
  });

  // ─── addExtraFieldsToAllRows ───────────────────────────────────

  describe('addExtraFieldsToAllRows', () => {
    it('adds injectable fields to all rows', () => {
      const data = makeData([[{ name: ['Alice'] }, { name: ['Bob'] }]]);
      const inputs = {
        injectable: { source: 'web' },
        originalInputs: {},
      };
      DataModifier.addExtraFieldsToAllRows(data, inputs);
      for (const row of data[0].group) {
        expect(row).toHaveProperty('source');
        expect(row.source[0].text).toBe('web');
      }
    });

    it('maps input fields using arrayOfInputFieldNamesToAdd with renaming', () => {
      const data = makeData([[{ name: ['Alice'] }]]);
      const inputs = {
        injectable: {},
        originalInputs: { searchTerm: 'shoes', location: 'NYC' },
        arrayOfInputFieldNamesToAdd: [{ searchTerm: 'query' }],
      };
      DataModifier.addExtraFieldsToAllRows(data, inputs);
      expect(data[0].group[0]).toHaveProperty('query');
      expect(data[0].group[0].query[0].text).toBe('shoes');
      // 'location' was not in the filter so should not be added
      expect(data[0].group[0]).not.toHaveProperty('location');
    });

    it('does nothing when injectable and fieldsFilter are both empty', () => {
      const data = makeData([[{ name: ['Alice'] }]]);
      const originalGroup = JSON.parse(JSON.stringify(data[0].group));
      const inputs = { injectable: {}, originalInputs: {}, arrayOfInputFieldNamesToAdd: [] };
      DataModifier.addExtraFieldsToAllRows(data, inputs);
      // Data should be unchanged (field values stay the same)
      expect(data[0].group[0].name).toEqual(originalGroup[0].name);
    });

    it('converts non-string text values to strings', () => {
      const data = makeData([[{ name: ['Alice'] }]]);
      const inputs = {
        injectable: { count: 42 },
        originalInputs: {},
      };
      DataModifier.addExtraFieldsToAllRows(data, inputs);
      expect(data[0].group[0].count[0].text).toBe('42');
    });
  });

  // ─── getAllMarkedFields ────────────────────────────────────────

  describe('getAllMarkedFields', () => {
    it('returns field names where values are marked for removal', () => {
      const data = [
        {
          group: [
            {
              link: [{ text: 'url', willBeRemovedInTransform: true }],
              name: [{ text: 'Alice', willBeRemovedInTransform: false }],
              price: [{ text: '10', willBeRemovedInTransform: true }],
            },
          ],
        },
      ];
      const result = DataModifier.getAllMarkedFields(data);
      expect(result).toContain('link');
      expect(result).toContain('price');
      expect(result).not.toContain('name');
    });
  });

  // ─── getAllFields ──────────────────────────────────────────────

  describe('getAllFields', () => {
    it('returns an object keyed by all field names found in data', () => {
      const data = makeData([
        [
          { name: ['Alice'], age: ['30'] },
          { name: ['Bob'], city: ['NYC'] },
        ],
      ]);
      const result = DataModifier.getAllFields(data);
      expect(result).toHaveProperty('name');
      expect(result).toHaveProperty('age');
      expect(result).toHaveProperty('city');
    });
  });
});
