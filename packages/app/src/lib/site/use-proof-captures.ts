// The Verification tab's background screenshot captures (spec 2026-09-25
// §2.2/§2.3, plan 5 Task 5): starts one `captureProofPage` per product url
// that has none yet, resumes whatever `proofPageCaptures` already knows about
// (a reload never redoes a capture in flight or landed), and polls each
// known capture id until it stops `capturing`. Pure hook — no UI.
import { useEffect, useRef, useState } from 'react';
import { keepPreviousData } from '@tanstack/react-query';
import { trpc, API_URL } from '../trpc';
import type { Box } from './verification-model';

export type ProofCapture = {
  captureId: string;
  status: 'starting' | 'capturing' | 'captured' | 'failed';
  error?: string;
  tiles: string[];
  boxes: Box[];
  pageHeight: number;
  capturedHeight: number;
};

const EMPTY_CAPTURE: Pick<ProofCapture, 'tiles' | 'boxes' | 'pageHeight' | 'capturedHeight'> = {
  tiles: [],
  boxes: [],
  pageHeight: 0,
  capturedHeight: 0,
};

/**
 * A tile's stored path is relative (`/captures/…png`); the api-server, not
 * this app, serves it. Copied from the old (now deleted) Schema tab's
 * `page-header-cell.tsx`'s `screenshotHref`.
 */
export function tileHref(path: string | null | undefined): string | null {
  if (!path) return null;
  if (path.startsWith('http://') || path.startsWith('https://')) return path;
  return `${API_URL}${path.startsWith('/') ? path : `/${path}`}`;
}

/**
 * `byUrl[url]` is undefined only when the hook is disabled (no `sourceId` or
 * no urls); once running, every url reads at least `{ status: 'starting' }`.
 * `captureIds` is exposed separately because it is what `transferMarks` and
 * the suggestion cache key off (a stale capture id is how a suggestion knows
 * it has gone stale — spec §2.3).
 */
export function useProofCaptures(
  sourceId: string | undefined,
  urls: string[],
): { byUrl: Record<string, ProofCapture | undefined>; captureIds: Record<string, string | null>; retry(url: string): void } {
  const enabled = !!sourceId && urls.length > 0;
  // A stable string to key the start-effect on, since `urls` is a fresh array
  // reference from the caller on every render.
  const urlsKey = urls.join('\n');

  // Keyed on the whole url list: without the previous answer held while the
  // new one loads, every card would flicker back to "taking screenshot…"
  // whenever one card changes (final review M3).
  const lookup = trpc.sources.proofPageCaptures.useQuery({ sourceId: sourceId ?? '', urls }, { enabled, placeholderData: keepPreviousData });

  // Captures this hook itself started this session, by url. Takes priority
  // over `lookup` so a retry's fresh id is never shadowed by the stale one
  // `proofPageCaptures` still has cached.
  const [started, setStarted] = useState<Record<string, string>>({});
  // A url whose `captureProofPage` mutation itself failed (never got a
  // captureId) — distinct from a capture that started and then failed, which
  // `proofPageCapture` reports on its own.
  const [startErrors, setStartErrors] = useState<Record<string, string>>({});
  // Guards React StrictMode's double effect invocation: without it, the dev
  // double-mount would fire `captureProofPage` twice for the same url before
  // either `started` write lands.
  const startingRef = useRef<Set<string>>(new Set());

  const captureMutation = trpc.sources.captureProofPage.useMutation();

  function start(url: string) {
    if (!sourceId) return;
    startingRef.current.add(url);
    // `mutateAsync`, not `mutate` with per-call callbacks: one mutation
    // observer reports only its LATEST call to those callbacks, so starting
    // three products at once would record only the third capture's id and
    // leave the other two on "taking screenshot…" until a reload.
    captureMutation.mutateAsync({ sourceId, url }).then(
      (data) => {
        startingRef.current.delete(url);
        setStarted((prev) => ({ ...prev, [url]: data.captureId }));
        setStartErrors((prev) => {
          if (!(url in prev)) return prev;
          const next = { ...prev };
          delete next[url];
          return next;
        });
      },
      (err: unknown) => {
        startingRef.current.delete(url);
        setStartErrors((prev) => ({ ...prev, [url]: err instanceof Error ? err.message : String(err) }));
      },
    );
  }

  useEffect(() => {
    // Placeholder data is the previous url list's answer: a new url is not in
    // it, and starting a capture on that basis could duplicate a stored one.
    if (!sourceId || !lookup.data || lookup.isPlaceholderData) return;
    for (const url of urls) {
      if (started[url]) continue;
      if (lookup.data[url]) continue;
      if (startingRef.current.has(url)) continue;
      start(url);
    }
    // `start` closes over `sourceId`/`captureMutation`, both stable enough
    // for this effect's purpose; re-running on `started` is what lets a url
    // that just landed a captureId fall out of the loop next pass.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceId, urlsKey, lookup.data, started]);

  const captureIds: Record<string, string | null> = {};
  for (const url of urls) {
    captureIds[url] = started[url] ?? lookup.data?.[url]?.captureId ?? null;
  }

  const idUrls = urls.filter((url) => captureIds[url] !== null);
  const ids = idUrls.map((url) => captureIds[url] as string);

  const polls = trpc.useQueries((t) =>
    ids.map((id) =>
      t.sources.proofPageCapture(
        { captureId: id },
        { refetchInterval: (query) => (query.state.data?.status === 'capturing' ? 2000 : false) },
      ),
    ),
  );

  const pollById = new Map(ids.map((id, i) => [id, polls[i]] as const));

  const byUrl: Record<string, ProofCapture | undefined> = {};
  for (const url of urls) {
    const startError = startErrors[url];
    if (startError) {
      byUrl[url] = { captureId: '', status: 'failed', error: startError, ...EMPTY_CAPTURE };
      continue;
    }
    const id = captureIds[url];
    if (!id) {
      byUrl[url] = { captureId: '', status: 'starting', ...EMPTY_CAPTURE };
      continue;
    }
    const data = pollById.get(id)?.data;
    if (!data) {
      byUrl[url] = { captureId: id, status: 'starting', ...EMPTY_CAPTURE };
      continue;
    }
    byUrl[url] = {
      captureId: id,
      status: data.status,
      ...(data.error ? { error: data.error } : {}),
      tiles: data.tiles,
      boxes: data.boxes,
      pageHeight: data.pageHeight,
      capturedHeight: data.capturedHeight,
    };
  }

  function retry(url: string) {
    setStartErrors((prev) => {
      if (!(url in prev)) return prev;
      const next = { ...prev };
      delete next[url];
      return next;
    });
    start(url);
  }

  return { byUrl, captureIds, retry };
}
