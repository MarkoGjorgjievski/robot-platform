# Captures without overlays — design

**Status:** built on `feat/capture-overlays` per its plan
(`docs/superpowers/plans/2026-10-19-capture-overlays.md`, which departs from §3.1–§3.4 in eight small
ways listed under "Where the plan departs from the spec"; the plan wins where they differ) and
proven offline by the fixture tests in `packages/browser`. The live check
(`docs/testing/capture-overlays-check.mts`) runs on `main` after merge. Not yet reviewed by Marko.
After the final whole-branch review, four more deviations: **the tabs step is off by default**
(`CaptureOptions.expandTabs`, default false; it never ran in a real capture before this branch, so
turning it on would change the DOM every certified source reads — on only after a free replay shows
no drift; §3.2.6, §5.3 and §6's tabs items hold when it is on); §3.1's last bullet counts a fixed box
only when it sits on top of page content (it covers the window's centre, or page content lies under
its own centre); outside an overlay dismissal never clicks what the expand pass opened, and the final
pass (§3.4) offers today's page-wide steps only inside an overlay or a consent-like layer; the
expand undo (§3.2.4) hides, rather than removes, a new overlay that is not `position: fixed`.
After the live check (2026-10-19, branch `fix/capture-overlays-live`; the screenshots showed three
pages still covered where "overlay at the centre" said none), three more: **§3.1 gains a smaller
popup** — a fixed or absolute box of 8 % to a quarter of the window, over page content, not the
header, footer or a bar along an edge, holding a close control (§3.3.4's words) and its own heading
or a layer's name (puma DE's 14 % location popup over the sizes); **§3.3's whole names gain the
common consent accept names** (`Accept`, `Allow cookies`, `Agree`, `Akzeptieren`, `Tout accepter`, …),
matched on a button's accessible name or its visible text (colourpop's "Accept" is labelled "allow
cookies"); and **a round whose clicks closed nothing presses Escape before the removal pass hides
what is left**, so a page closes its modal its own way and takes its scrim with it (kith's welcome
mat leaves `body.modal-background::before` dimming the window when it is merely hidden), with a
net: the removal pass stops painting a scrim `<html>` or `<body>` draws with `::before`/`::after`
(fixed, painted, over a quarter of the window, not behind the page). The live check now also lists
every fixed layer of 5 % or more and every translucent layer over half the window.
The problem comes from campaign 2, group 2 (`docs/testing/2026-10-11-campaign-2.md`, "Captures keep or open
overlays"). Every cause below was seen on the real pages on 2026-10-19, free and keyless
(`docs/testing/results/2026-10-19-capture-overlays/findings.md`, screenshots and the probe script
beside it), and read in `packages/browser/src/playwright-browser.ts` on `main` @ `ed3cf41`.

## 1. Why

A proof page's screenshot is where the customer marks a value and where the judge and Jev read
it. Campaign 2 found eight sites where the screenshot showed a modal, a drawer, a lightbox or a
cookie centre instead of the product:

- marking became impossible: thomann stopped because Verify asked to "mark it on the
  screenshot" where a video player sat;
- the judge went blind: skullcandy's prices sat under a modal, and judge money bought nothing.

The campaign assumed the pages arrive with these overlays. Mostly they do not: **our own capture
opens them.** Of the eight, the expand pass opens four, the dismissal pass opens or keeps three,
and one is a popup no rule matches. The dismissal pass also once clicked a colour swatch and
changed the variant the page shows (puma DE, "Rosy Outl**ook**" matching `OK`), the same family as
campaign group 1's wrong-variant values.

Wide layouts (ridge, ruggable, mejuri at x≈2000–3500) are not in this spec: the stealth fix of
2026-10-16 (`e59a2ed`) cured them, and the probe confirms mejuri now lays out at 1280 px.

## 2. What happens today

`capture()` runs, after navigation: `dismissPopups` (a selector list, up to three rounds, one
click per round; a JavaScript removal pass only in a round where nothing was clicked), then
`expandHiddenContent` (two rounds of: click every visible `main/article
[aria-expanded="false"]`, `details summary`, `[data-toggle="collapse"]`; click buttons whose text
is "show more" and similar; click every tab), then `returnIfNavigatedAway`, then the screenshot.

| Site | Overlay on the screenshot | Cause |
|---|---|---|
| colourpop | zoom lightbox | expand clicks `<button aria-expanded="false">Zoom</button>` (no `aria-controls`); it opens `<modal-dialog open>` |
| mejuri | size guide sheet | expand clicks `button[aria-haspopup=dialog]` |
| kith | size guide drawer, "Don't see your size?" modal | expand clicks `[aria-controls=ProductSizeDrawer]` → `role=dialog`, fixed; and a control that opens a fixed `<s-modal>` |
| thomann | YouTube modals, a warnings drawer | expand clicks `button[aria-haspopup=dialog]` and `a[href="#"][aria-haspopup=dialog]` |
| ikea | cookie preference centre | dismissal accepts OneTrust, then `button:has-text("OK")` matches "Cookie settings" and opens the centre; the click also leaves the page scrolled to y≈1000 |
| skullcandy | geo modal | matched twice over, but three rounds go to dead clicks ("OK" matching "look"; a close button under the backdrop); the removal pass never runs |
| lacoste | consent modal | `[aria-label="Close"]` matches a promo bar's close button that never goes away, three rounds running |
| puma DE | location popup; OneTrust | a section with no role whose button reads "Schließen"; OneTrust appears after dismissal has ended; once, "OK" clicked a colour swatch |

Found on the same pages: the two expand rounds toggle mejuri's single-open accordion so
"Materials & Specifications" ends closed; the tabs step followed a link to thomann's service page
and clicks ikea's PDF links.

## 3. The rule

**A capture closes what the page put over the product, and never opens anything over it
itself.** Everything it reveals is content that belongs in the page (accordions, `<details>`,
tabs, "show more"); everything it closes is a layer over the page.

### 3.1 What an overlay is

One definition, used by every rule below. An element is an **overlay** when it is visible (has a
box, not `display:none`, not `visibility:hidden`, opacity above 0) and any of:

- `role="dialog"` or `role="alertdialog"`, or `aria-modal="true"`;
- an open `<dialog>`;
- its tag name, id or class contains `modal`, `drawer`, `lightbox`, `popup` or `dialog`, and it
  is `position: fixed` or `absolute` with a box covering at least a quarter of the viewport;
- it is `position: fixed`, covers at least a quarter of the viewport, and is not the page's
  header or footer (`header`, `footer`, `nav`, `[role=banner]`, `[role=navigation]`, or a box
  less than 200 px tall at the top or bottom edge).

The **topmost overlay** is the one the browser hit-tests first at the viewport's centre
(`elementsFromPoint`), or failing that the overlay with the highest stacking order.

### 3.2 The expand pass never opens an overlay

1. It skips a control with `aria-haspopup` of `dialog`, `true`, `menu`, `listbox`, `grid` or
   `tree`.
2. It skips a control whose `aria-controls` names an element that is dialog-like: the §3.1
   roles, `<dialog>`, a tag/id/class containing `modal`, `drawer`, `lightbox` or `popup`, or
   `position: fixed`.
3. It skips anything inside an overlay.
4. **Undo.** After each round it looks for overlays that were not there before the round. Each
   new one is closed: `Escape` once, then, if it is still there, it is removed from the DOM and
   the body's scroll lock is lifted. The controls clicked that round are not clicked again.
   This is the net for controls no attribute gives away (colourpop's `Zoom`).
5. It clicks each element at most once across both rounds, so a single-open accordion ends with
   the panel it opened still open (mejuri).
6. The tabs step never clicks an anchor that navigates (`hrefNavigates`, the rule dismissal
   already uses) or a link to a file (`.pdf` and similar).

### 3.3 Dismissal closes overlays without touching the page

1. **Whole names, not substrings.** The text selectors (`OK`, `Close`, `Got it`, `Accept all`, …)
   match a button whose accessible name, trimmed and case-folded, *is* the text — never one that
   *contains* it. "Cookie settings", "look" and "Rosy Outlook" no longer match `OK`.
2. **Never the page's own controls.** Dismissal never clicks:
   - a variant control: an element with `aria-pressed` or `aria-checked`, `role=radio`, `option`
     or `tab`, an `input`, an element inside a `fieldset`, `[role=radiogroup]` or
     `[role=listbox]`, or one with a class word containing `swatch` or `variant` — unless it sits
     inside an overlay (a consent dialog's own toggles are not the product's);
   - anything named settings, preferences, manage, customise/customize, options or more info
     (in any case);
   - an element that navigates (`hrefNavigates`, as today).
3. **A click counts only if it worked.** After a click, the clicked element (or the overlay it
   sits in) must be gone or hidden. A click that changed nothing is not a dismissal, the element
   is never clicked again in this capture, and the round goes on to the next selector instead of
   ending.
4. **Close the topmost layer.** Each round first looks at the topmost overlay (§3.1) and clicks,
   inside it, a button or link whose accessible name or `aria-label` is a close word: close,
   schließen, schliessen, fermer, cerrar, chiudi, sluiten, fechar, zamknij, stäng, luk, lukk,
   sulje, ×, ✕, x, dismiss, no thanks, not now, continue shopping, stay here. If it has none,
   it falls through to the selector list.
5. **The removal pass runs every round,** after the clicks, not only in a round with no click. It
   removes overlays by the §3.1 definition plus today's selectors, and lifts the scroll lock.
6. **Rounds stop when nothing changed:** no successful click and nothing removed. At most four
   rounds (today three).

### 3.4 One more pass just before the screenshot

After the expand pass and `returnIfNavigatedAway`, and after any `after-expand` readiness wait,
dismissal runs once more (late banners: puma's OneTrust), then the page scrolls to the top
(ikea's y≈1000). If an overlay is still at the viewport's centre after that, the capture logs one
warning line naming it (tag, id, first 60 characters of its text), as the wide-layout warning
does. Nothing about the capture's result changes.

## 4. What a customer sees

Nothing new on any screen. A proof page's screenshot shows the product where today it showed a
modal, so marking works where it did not; the judge and Jev read the product. Captures already
stored are not redone; a re-capture (a re-Verify, "Take the screenshot again", or after the 24 h
store) gets the clean screenshot.

The captured HTML keeps what it has today: an accordion's text, a size guide's hidden markup, a
dialog's DOM that was never opened. Only what the screenshot shows changes, plus the HTML of
overlays that our own clicks used to open (which held no product field).

## 5. Safety properties

1. A capture never clicks a variant control. The variant a page shows after capture is the one
   it showed after navigation.
2. A capture never ends on another page because of its own clicks (today's rule, now also for
   the tabs step).
3. Every expansion a product page needs survives: on the eight sites, the mejuri, puma and ikea
   accordions, skullcandy's `<details>`, and the kith, ikea and thomann tabs stay expanded.
4. No rule depends on a site's name, domain or language beyond the close words of §3.3.4.
5. A page with no overlay is captured as today: no extra wait longer than the existing ones, no
   extra screenshot.

## 6. Testing

- **Fixtures, in Chromium** (`packages/browser`, served locally as the existing capture tests
  do), one per mechanism:
  - a `Zoom` button with `aria-expanded` and no `aria-controls` that opens a lightbox: closed on
    the final screenshot (the undo net);
  - `aria-haspopup="dialog"` size guide; `aria-controls` → `role=dialog` fixed drawer: never
    opened;
  - an accordion with `aria-controls` → a plain panel, a `<details>`, and tabs: all expanded;
  - a single-open accordion: its panel ends open;
  - "Cookie settings", a review chip "look" and a swatch "Rosy Outlook" beside a real `OK`
    consent button: only the consent button is clicked; the swatch's selection is unchanged;
  - a promo bar whose close button never closes it, plus a consent modal: the consent modal is
    closed;
  - a location popup with no role, a fixed full-screen box and a "Schließen" button: closed;
  - a cookie banner that appears two seconds after load: closed by the final pass;
  - a page scrolled by a dismissal click: the screenshot starts at the top;
  - a tabs strip whose second tab is a link to another page or a PDF: not followed.
- **Unit tests** for the pure pieces: the close-word and exact-name matching, the
  variant-control test, the overlay definition's geometry rules.
- **Live check, free:** `probe.mts` mode A over the same proof pages before and after, screenshots
  side by side in the results folder; the expected outcome per site is "no overlay at the
  viewport's centre" and the accordions of §5.3 still open.

## 7. Not in this spec

- Thomann's `waitUntil: 'load'` timing out at 45 s. Proof-page captures use `networkidle` with a
  fallback and are not affected; the judge and Jev scripts use `load`. A small follow-up.
- Geo: the capture browser is in Malaysia (MYR prices, geo modals, redirects). Closing a geo modal
  is in; choosing the shop's country is not.
- Lazy grids, listing pages and the finder (campaign group 4).
- Overlays that cover only part of the product column (a sticky "add to bag" bar): they leave the
  product visible.
- Reading values out of a dialog the page never opens (a size table): not a product field today.

## 8. Recommended decisions

1. **Undo, not only skip.** Attribute rules alone miss colourpop's `Zoom` (nothing marks it as a
   dialog trigger). Closing any overlay that appears during the expand pass catches it and any
   future one, at the cost of one DOM scan per round.
2. **Exact names everywhere in dismissal.** Substring text matching is what clicked the swatch;
   a cookie button whose name is "OK, got it" is listed explicitly instead.
3. **No new field on the capture result.** A remaining overlay is a log line; the customer-facing
   message for "the product is covered" can come later if the live check shows it is still common.
