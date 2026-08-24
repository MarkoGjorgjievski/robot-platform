import { describe, it, expect } from 'vitest';
import type { IBrowser } from '@robot/browser';
import { buildFetchScript, fetchInPage, type FetchedBody } from './api-param-fetch.js';

describe('buildFetchScript', () => {
  it('embeds the URLs as data, not as code', () => {
    // A URL carrying a quote must not be able to close the string and run.
    const script = buildFetchScript(['https://x.example/a?q=\'); alert(1); //']);
    expect(script).toContain(JSON.stringify(['https://x.example/a?q=\'); alert(1); //']));
  });

  it('asks for credentials, which is the whole reason to fetch in-page', () => {
    expect(buildFetchScript(['https://x.example/a'])).toContain("credentials: 'include'");
  });
});

describe('fetchInPage', () => {
  it('evaluates once for the whole batch rather than once per URL', async () => {
    const calls: string[] = [];
    const browser = {
      evaluate: async (url: string) => { calls.push(url); return [] as FetchedBody[]; },
    } as unknown as IBrowser;

    await fetchInPage(browser, 'https://x.example/list', ['a', 'b', 'c']);

    expect(calls).toEqual(['https://x.example/list']);
  });

  it('answers an empty batch without touching the browser at all', async () => {
    let called = false;
    const browser = { evaluate: async () => { called = true; return []; } } as unknown as IBrowser;

    expect(await fetchInPage(browser, 'https://x.example/list', [])).toEqual([]);
    expect(called).toBe(false);
  });

  it('degrades to an empty batch when the page context itself fails', async () => {
    // Pagination is an optimisation. A navigation failure must never lose the
    // work page 1 already planned, so this answers [] rather than throwing.
    const browser = {
      evaluate: async () => { throw new Error('net::ERR_ABORTED'); },
    } as unknown as IBrowser;

    expect(await fetchInPage(browser, 'https://x.example/list', ['a'])).toEqual([]);
  });
});
