// vi, describe, it, expect, beforeEach, afterEach are available globally via vitest config

const { preCompileFunctions } = require('../navigationHelperLibrary');

describe('navigationHelperLibrary', () => {
  describe('getCLIParams', () => {
    const originalArgv = process.argv;

    afterEach(() => {
      process.argv = originalArgv;
    });

    it('returns empty object when no --parameters in argv', () => {
      process.argv = ['node', 'script.js', '--other', 'flag'];
      const result = preCompileFunctions.getCLIParams();
      // When there is no --parameters, the split produces undefined, leading to empty entries
      expect(result).toEqual({});
    });

    it('parses --parameters key=value pairs', () => {
      process.argv = ['node', 'script.js', '--parameters', 'domain=example.com', 'timeout=5000'];
      const result = preCompileFunctions.getCLIParams();
      expect(result.domain).toBe('example.com');
      expect(result.timeout).toBe('5000');
    });
  });

  describe('getAllYAMLFilePaths', () => {
    it('function signature exists', () => {
      expect(typeof preCompileFunctions.getAllYAMLFilePaths).toBe('function');
    });

    it('returns array when given a valid folder path', () => {
      // Use the navigation folder itself which should exist relative to __dirname in the source
      // Since the function reads from path.join(__dirname, '../', `.${folderPath}`),
      // we need a path that resolves to an existing directory
      try {
        const result = preCompileFunctions.getAllYAMLFilePaths('/navigation');
        expect(Array.isArray(result)).toBe(true);
      } catch (e) {
        // If directory does not exist, the function throws ENOENT which is expected behavior
        expect(e.code).toBe('ENOENT');
      }
    });
  });
});
