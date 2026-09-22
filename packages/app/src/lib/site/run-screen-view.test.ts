import { describe, it, expect } from 'vitest';
import {
  isRunId,
  reExtractedLabel,
  repairNote,
  resultsNote,
  resultsSummary,
  runFacts,
  runStatusLine,
  shortRunId,
  workListNote,
} from './run-screen-view';

const NOW = new Date('2026-09-22T12:00:00.000Z');
const ago = (ms: number) => new Date(NOW.getTime() - ms);

describe('isRunId', () => {
  it('accepts a uuid, in either case', () => {
    expect(isRunId('3f1a2b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b')).toBe(true);
    expect(isRunId('3F1A2B4C-5D6E-4F70-8A9B-0C1D2E3F4A5B')).toBe(true);
  });

  it('refuses anything else, so a mistyped address is a wrong address and not a failed request', () => {
    expect(isRunId('latest')).toBe(false);
    expect(isRunId('')).toBe(false);
    expect(isRunId('3f1a2b4c-5d6e-4f70-8a9b')).toBe(false);
    expect(isRunId('3f1a2b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b ')).toBe(false);
  });
});

describe('shortRunId', () => {
  it('is the first block of the uuid', () => {
    expect(shortRunId('3f1a2b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b')).toBe('3f1a2b4c');
  });
});

describe('runStatusLine', () => {
  it('reads as the Runs table reads', () => {
    expect(runStatusLine({ status: 'completed', completedAt: NOW, inputLabel: null }))
      .toEqual({ state: 'done', label: 'Done' });
    expect(runStatusLine({ status: 'failed', completedAt: NOW, inputLabel: null }))
      .toEqual({ state: 'failed', label: 'Failed' });
    expect(runStatusLine({ status: 'partial', completedAt: NOW, inputLabel: null }))
      .toEqual({ state: 'partial', label: 'Partial' });
  });

  it('names a sample and a repair, which are not ordinary extractions', () => {
    expect(runStatusLine({ status: 'completed', completedAt: NOW, inputLabel: 'probe' }).label)
      .toBe('Done · sample');
    expect(runStatusLine({ status: 'partial', completedAt: NOW, inputLabel: 'backfill' }).label)
      .toBe('Partial · repair');
  });

  it('pulses only while something is actually moving', () => {
    expect(runStatusLine({ status: 'extracting', completedAt: null, inputLabel: null }).state).toBe('running');
    // An abandoned run: still `extracting`, but finished. Grey, not a pulse.
    expect(runStatusLine({ status: 'extracting', completedAt: NOW, inputLabel: null }).state).toBe('idle');
  });
});

describe('runFacts', () => {
  it('reports the four facts of a finished run', () => {
    expect(runFacts(
      { startedAt: ago(5 * 60_000), completedAt: ago(4 * 60_000), resultCount: 1204 },
      NOW,
    )).toEqual([
      { label: 'Started', value: '5 min ago' },
      { label: 'Completed', value: '4 min ago' },
      { label: 'Duration', value: '1 min' },
      { label: 'Rows', value: '1,204' },
    ]);
  });

  it('says nothing it does not know', () => {
    expect(runFacts({ startedAt: null, completedAt: null, resultCount: null }, NOW)).toEqual([
      { label: 'Started', value: '—' },
      { label: 'Completed', value: '—' },
      { label: 'Duration', value: '—' },
      { label: 'Rows', value: '—' },
    ]);
  });

  it('has no duration for a run still going', () => {
    const facts = runFacts({ startedAt: ago(90_000), completedAt: null, resultCount: 0 }, NOW);
    expect(facts[0]).toEqual({ label: 'Started', value: '1 min ago' });
    expect(facts[2]).toEqual({ label: 'Duration', value: '—' });
    expect(facts[3]).toEqual({ label: 'Rows', value: '0' });
  });
});

describe('repairNote', () => {
  it('names the fields a repair was sent to fix', () => {
    expect(repairNote(['price', 'title'])).toBe('repairing price, title');
  });

  it('is silent when nothing in particular was targeted', () => {
    expect(repairNote(null)).toBe(null);
    expect(repairNote(undefined)).toBe(null);
    expect(repairNote([])).toBe(null);
  });
});

describe('reExtractedLabel', () => {
  it('counts its own noun', () => {
    expect(reExtractedLabel(1)).toBe('Re-extracted in 1 run');
    expect(reExtractedLabel(3)).toBe('Re-extracted in 3 runs');
  });
});

describe('resultsSummary', () => {
  it('leads with the rows, and adds confidence only when there is one', () => {
    expect(resultsSummary(1204, 92)).toBe('1,204 rows · 92% confidence');
    expect(resultsSummary(1204, null)).toBe('1,204 rows');
    expect(resultsSummary(1, null)).toBe('1 row');
    expect(resultsSummary(0, null)).toBe('No rows');
  });
});

describe('resultsNote', () => {
  it('says what is on the screen when it is not everything', () => {
    expect(resultsNote(500, 1204)).toBe('Showing the first 500 of 1,204 — the download has all of them.');
  });

  it('is silent when everything is on the screen', () => {
    expect(resultsNote(40, 40)).toBe(null);
    expect(resultsNote(0, 0)).toBe(null);
  });
});

describe('workListNote', () => {
  it('says what is on the screen, with no download to point at', () => {
    expect(workListNote(200, 512)).toBe('Showing the first 200 of 512 pages.');
    expect(workListNote(200, 200)).toBe(null);
  });
});
