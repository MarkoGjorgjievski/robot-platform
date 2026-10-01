/**
 * The Verification tab's Variants step (spec 2026-10-01 §3): what the proof
 * pages' captures show about how this website exposes variants, said in the
 * customer's words, and the state the step is in. Pure.
 *
 * The detection types are declared here rather than imported: the app derives
 * no router output types anywhere else, and `@robot/scraper` (where the list,
 * link and picker shapes live) must never reach a browser bundle. They mirror
 * `sources.detectVariants`'s output; `tsc` on the route that passes the query's
 * data in is what keeps the two in step.
 */

export type VariantMethod = 'list' | 'links' | 'none';

export type DetectedList = { source: string; path: string; count: number; axes: string[]; entries: Array<Record<string, string>> };
export type DetectedLinks = { container: string; count: number; links: Array<{ href: string; label: string }> };
export type DetectedPicker = { axis: string; options: string[] };
export type DetectedPage = { url: string; captured: boolean; lists: DetectedList[]; links: DetectedLinks[]; pickers: DetectedPicker[] };
/** `sources.detectVariants`'s output. */
export type DetectResult = { pages: DetectedPage[]; suggested: VariantMethod };
/** A website's stored setup (`sources.get`'s `variantSetup`). */
export type VariantSetup = { method: VariantMethod; axes: Array<{ from: string; axisKey: string }>; confirmedAt: string };

export type VariantsStepState =
  | { kind: 'off' }
  | { kind: 'no-pages'; reason: string }
  /** `initialMethod`: what the method choice opens on — the confirmed method when changing a setup, else the suggestion. */
  | { kind: 'found'; summary: string[]; suggested: VariantMethod; initialMethod: VariantMethod; axes: Array<{ from: string; label: string; options: string[] }>; pickerOnly: string[] }
  | { kind: 'set'; method: VariantMethod; axes: Array<{ from: string; axisName: string }> };

export const METHOD_LABELS: Record<VariantMethod, string> = {
  list: 'Listed in the page data',
  links: 'Linked as separate pages',
  none: 'No variants on this website',
};

/** The same choices, as the tail of "Variants: …" once one is confirmed. */
const METHOD_SET_WORDS: Record<VariantMethod, string> = {
  list: 'listed in the page data',
  links: 'linked as separate pages',
  none: 'none on this website',
};

/**
 * The plain word an axis name stands for: `color` and `colour` are both
 * "colour", `option1`–`option3` are "option", and a picker's label such as
 * "choose a size" is "size". A name with no known word in it is kept as it is.
 */
const KNOWN_WORDS = /\b(colou?r|size|length|width|height|material|pattern|style|capacity|flavou?r|scent|finish)\b/;
function axisWord(raw: string): string {
  const t = raw.trim().toLowerCase();
  if (/^option\s*\d*$/.test(t)) return 'option';
  const m = KNOWN_WORDS.exec(t);
  if (!m) return t || 'option';
  return m[1]!.replace(/^color$/, 'colour').replace(/^flavor$/, 'flavour');
}

/** "colours", "sizes", "options", "lengths". */
export function axisPlural(raw: string): string {
  const w = axisWord(raw);
  return w.endsWith('s') ? w : `${w}s`;
}

/** The column name a new axis would get: "Colour", "Size", "Option 2". */
export function axisLabel(raw: string): string {
  const option = /^option\s*(\d+)$/.exec(raw.trim().toLowerCase());
  if (option) return `Option ${option[1]}`;
  const w = axisWord(raw);
  return w.charAt(0).toUpperCase() + w.slice(1);
}

/** A link group's axis: the word its container's class or id names, else a same-page picker offering the same choices, else "option". */
function linksWord(group: DetectedLinks, pickers: DetectedPicker[]): string {
  const m = KNOWN_WORDS.exec(group.container.toLowerCase());
  if (m) return axisWord(m[1]!);
  const labels = new Set(group.links.map((l) => l.label.trim().toLowerCase()));
  const picker = pickers.find((p) => p.options.some((o) => labels.has(o.trim().toLowerCase())));
  return picker ? axisWord(picker.axis) : 'option';
}

/** How many of one list's variants there are, and the word for them: distinct values of its one axis, else every entry as a "variant". */
function listCount(list: DetectedList): { n: number; word: string } {
  if (list.axes.length === 1) {
    const axis = list.axes[0]!;
    const distinct = new Set(list.entries.map((e) => e[axis]).filter((v): v is string => !!v));
    return { n: distinct.size || list.count, word: axisPlural(axis) };
  }
  return { n: list.count, word: 'variants' };
}

/**
 * One phrase per product, the word said only when it changes from the one
 * before ("2 colours on product 1, 3 on product 2, none on product 3"); said
 * once when every product is checked and shows the same ("… on every product").
 */
function perProduct(
  pages: DetectedPage[],
  found: (p: DetectedPage) => { n: number; word: string } | null,
  every: (n: number, word: string) => string,
): string {
  const each = pages.map((p) => (p.captured ? found(p) : undefined));
  const first = each[0];
  if (first && each.every((e) => e && e.n === first.n && e.word === first.word)) return every(first.n, first.word);
  let lastWord: string | null = null;
  return each
    .map((e, i) => {
      if (e === undefined) return `not checked on product ${i + 1}`;
      if (e === null) return `none on product ${i + 1}`;
      const said = e.word === lastWord ? `${e.n}` : `${e.n} ${e.word}`;
      lastWord = e.word;
      return `${said} on product ${i + 1}`;
    })
    .join(', ');
}

/** Every value the page data or a link group shows, lower-cased: what a picker's choices are checked against. */
function shownElsewhere(d: DetectResult): Set<string> {
  const out = new Set<string>();
  for (const p of d.pages) {
    for (const l of p.lists) for (const e of l.entries) for (const v of Object.values(e)) out.add(v.trim().toLowerCase());
    for (const g of p.links) for (const l of g.links) out.add(l.label.trim().toLowerCase());
  }
  return out;
}

/** The plural words of the axes found only in a picker, each once: "sizes". */
function pickerOnlyWords(d: DetectResult): string[] {
  const elsewhere = shownElsewhere(d);
  const out: string[] = [];
  for (const p of d.pages) {
    for (const picker of p.pickers) {
      if (picker.options.some((o) => elsewhere.has(o.trim().toLowerCase()))) continue;
      const word = axisPlural(picker.axis);
      if (!out.includes(word)) out.push(word);
    }
  }
  return out;
}

/** What the proof pages show, one line per way a website can show variants. */
export function summaryLines(d: DetectResult): string[] {
  const lines: string[] = [];
  if (d.pages.some((p) => p.lists.length > 0)) {
    const said = perProduct(
      d.pages,
      (p) => (p.lists[0] ? listCount(p.lists[0]) : null),
      (n, word) => `${n} ${word} on every product`,
    );
    lines.push(`${METHOD_LABELS.list}: ${said}`);
  }
  if (d.pages.some((p) => p.links.length > 0)) {
    const said = perProduct(
      d.pages,
      (p) => {
        const g = p.links[0];
        if (!g) return null;
        const w = linksWord(g, p.pickers);
        return { n: g.count, word: w === 'option' ? 'links' : `${w} links` };
      },
      (n, word) => `${n} ${word} per product`,
    );
    lines.push(`${METHOD_LABELS.links}: ${said}`);
  }
  const pickers = pickerOnlyWords(d);
  if (pickers.length > 0) lines.push(`Only in a picker on the page: ${pickers.join(', ')} — not collected in this version`);
  return lines.length > 0 ? lines : ['No variants found on these products'];
}

/** The axes a method would collect, each with the choices seen across the proof pages, in the order first seen. */
export function axesFor(d: DetectResult, method: VariantMethod): Array<{ from: string; label: string; options: string[] }> {
  const byFrom = new Map<string, string[]>();
  const add = (from: string, value: string | undefined) => {
    const opts = byFrom.get(from) ?? [];
    if (value && !opts.includes(value)) opts.push(value);
    byFrom.set(from, opts);
  };
  for (const p of d.pages) {
    if (method === 'list') {
      const list = p.lists[0];
      if (!list) continue;
      for (const axis of list.axes) {
        add(axis, undefined);
        for (const e of list.entries) add(axis, e[axis]);
      }
    } else if (method === 'links') {
      for (const g of p.links) {
        const from = linksWord(g, p.pickers);
        add(from, undefined);
        for (const l of g.links) add(from, l.label.trim() || undefined);
      }
    }
  }
  return [...byFrom].map(([from, options]) => ({ from, label: axisLabel(from), options }));
}

export function variantsStepState(args: {
  mode: string;
  cards: number;
  detection: DetectResult | null;
  setup: VariantSetup | null;
  axes: Array<{ key: string; name: string }>;
  /** The customer pressed Change: the form opens again on the stored method. */
  changing?: boolean;
  /** Products whose screenshot failed (the cards say so and offer Try again). */
  failedCards?: number;
}): VariantsStepState {
  const { mode, cards, detection, setup, axes, changing = false, failedCards = 0 } = args;
  if (mode === 'ignore') return { kind: 'off' };
  if (setup && !changing) {
    return {
      kind: 'set',
      method: setup.method,
      axes: setup.axes.map((a) => ({ from: a.from, axisName: axes.find((x) => x.key === a.axisKey)?.name ?? axisLabel(a.from) })),
    };
  }
  if (cards === 0) return { kind: 'no-pages', reason: 'Find products first' };
  if (!detection || !detection.pages.some((p) => p.captured)) {
    // Every product's screenshot failed: waiting will not help, a retry on the cards will.
    return { kind: 'no-pages', reason: failedCards >= cards ? 'The screenshots failed — retry them above' : 'Wait for the screenshots' };
  }
  const initialMethod = setup ? setup.method : detection.suggested;
  return {
    kind: 'found',
    summary: summaryLines(detection),
    suggested: detection.suggested,
    initialMethod,
    axes: axesFor(detection, initialMethod),
    pickerOnly: pickerOnlyWords(detection),
  };
}

/** "Variants: linked as separate pages · Colour". */
export function setLine(state: Extract<VariantsStepState, { kind: 'set' }>): string {
  const names = state.axes.map((a) => a.axisName);
  return `Variants: ${METHOD_SET_WORDS[state.method]}${names.length > 0 ? ` · ${names.join(', ')}` : ''}`;
}
