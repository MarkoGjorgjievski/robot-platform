import { describe, it, expect } from 'vitest';
import { parseRunLog } from './parse-run-log';

describe('parseRunLog', () => {
  it('returns empty warnings/errors for null logs', () => {
    expect(parseRunLog(null)).toEqual({ warnings: [], errors: [] });
  });

  it('returns empty warnings/errors for undefined logs', () => {
    expect(parseRunLog(undefined)).toEqual({ warnings: [], errors: [] });
  });

  it('returns empty warnings/errors for an empty string', () => {
    expect(parseRunLog('')).toEqual({ warnings: [], errors: [] });
  });

  it('extracts a single warning line, stripped of its "warning: " prefix', () => {
    const logs = 'warning: no pagination detected on https://x.example — planned page 1 only';
    expect(parseRunLog(logs)).toEqual({
      warnings: ['no pagination detected on https://x.example — planned page 1 only'],
      errors: [],
    });
  });

  it('extracts a single error line, stripped of its "error: input N: " prefix', () => {
    const logs = 'error: input 0: Page blocked or unusable: HTTP 404 Not Found — page does not exist';
    expect(parseRunLog(logs)).toEqual({
      warnings: [],
      errors: ['Page blocked or unusable: HTTP 404 Not Found — page does not exist'],
    });
  });

  it('separates multiple warning and error lines, preserving order within each bucket', () => {
    const logs = [
      'warning: budget reached: 40 items; 2 input(s) not planned',
      'error: input 0: Page blocked or unusable: CAPTCHA detected — site requires human verification',
      'warning: pagination (fresh: url-pattern) gained only 1 new item(s) on https://x — re-serving page 1',
      'error: input 2: connection refused',
    ].join('\n');

    expect(parseRunLog(logs)).toEqual({
      warnings: [
        'budget reached: 40 items; 2 input(s) not planned',
        'pagination (fresh: url-pattern) gained only 1 new item(s) on https://x — re-serving page 1',
      ],
      errors: [
        'Page blocked or unusable: CAPTCHA detected — site requires human verification',
        'connection refused',
      ],
    });
  });

  it('ignores blank lines and trims surrounding whitespace', () => {
    const logs = '  warning: thin walk  \n\n  \nerror: input 1: dead link  ';
    expect(parseRunLog(logs)).toEqual({
      warnings: ['thin walk'],
      errors: ['dead link'],
    });
  });

  it('ignores a line matching neither prefix', () => {
    const logs = 'some unrelated free-text line\nwarning: real one';
    expect(parseRunLog(logs)).toEqual({ warnings: ['real one'], errors: [] });
  });
});
