// The in-page half of the scroll walk: measure, stamp, and scope.
//
// Every judgement — has it grown, is it quiet, are we done — lives in the
// generator in Node. These are pure string builders so they can be tested
// without a browser, and so the loop's decisions can be tested without a page.

/** The attribute marking a row this walk has already extracted. */
export const SEEN_ATTR = 'data-robot-seen';

/**
 * Page 1's own row xpath, scoped to rows not yet stamped.
 *
 * Appended as a predicate rather than woven into the expression: the xpath comes
 * from the extraction plan and may use axes or functions this module knows
 * nothing about, so the only safe edit is one that composes.
 */
export function unseenXpath(rowXpath: string): string {
  return `${rowXpath}[not(@${SEEN_ATTR})]`;
}

/**
 * How many rows are on the page in total.
 *
 * Deliberately counts stamped rows too. Growth is a property of the whole list;
 * measuring only unstamped rows would read "0" after every successful round and
 * make a growing list look finished.
 */
export function rowCountScript(rowXpath: string): string {
  return `(() => {
  const xp = ${JSON.stringify(rowXpath)};
  const r = document.evaluate(xp, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
  return r.snapshotLength;
})()`;
}

/** Stamp every matching row, so the next round's extraction skips it. */
export function stampScript(rowXpath: string): string {
  return `(() => {
  const xp = ${JSON.stringify(rowXpath)};
  const r = document.evaluate(xp, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
  let n = 0;
  for (let i = 0; i < r.snapshotLength; i++) {
    const el = r.snapshotItem(i);
    if (el && el.setAttribute) { el.setAttribute(${JSON.stringify(SEEN_ATTR)}, '1'); n++; }
  }
  return n;
})()`;
}
