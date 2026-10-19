# Capture overlays — what opens them (2026-10-19)

A free, keyless investigation of campaign 2's group 2 ("captures keep or open overlays"),
docs/testing/2026-10-11-campaign-2.md. Each site's proof pages were captured with the real
`PlaywrightBrowser` (mode A, screenshots `<site>-<n>-A.png` here), with a logged copy of the
dismissal and expand passes (mode B: every click, a screenshot after each pass) and one click
at a time (mode C). Script: `probe.mts` (run from `packages/browser`). The browser is in Malaysia.

## Per site

| Site | Overlay on the screenshot | Opened by | The element |
|---|---|---|---|
| colourpop | zoom lightbox | the expand pass | 5 × `<button aria-expanded="false">Zoom</button>`, no `aria-controls`, no `aria-haspopup`; opens `<modal-dialog … open>` (not fixed, no role) |
| mejuri | Size Guide bottom sheet (campaign saw the Material Guide; same mechanism) | the expand pass | `button#size-guide[aria-haspopup=dialog]` opens a Radix sheet. The page is no longer wide (1280 px, h1 at x=756) |
| kith | size guide drawer; "Don't see your size?" modal | the expand pass | `VIEW SIZE GUIDE[aria-controls=ProductSizeDrawer]` → `<s-drawer role=dialog>`, fixed; `DON'T SEE YOUR SIZE?` → fixed `<s-modal>` |
| thomann | YouTube review modals; "Sicherheits- und Warnhinweise" drawer | the expand pass | `button[aria-haspopup=dialog]` "YOUTUBE … abspielen"; `a[href="#"][aria-haspopup=dialog]` "Sicherheits- und Warnhinweise". Separately `waitUntil:'load'` timed out at 45 s on all three pages (proof-page captures use `networkidle` with a fallback, so this hits the judge and Jev scripts only) |
| ikea | cookie preference centre | the dismissal pass | OneTrust is accepted, then `button:has-text("OK")` matches "Cookie settings" ("Co**ok**ie") and opens the preference centre. The locator click also leaves the page scrolled to y≈1000 |
| skullcandy | "We don't ship to Malaysia" modal | not dismissed | already matched twice (`[aria-label="Close"]`, and the JS removal), but all 3 rounds go to dead clicks: "OK" matching a review chip "look", or `#cookieclose` hidden under the backdrop; the JS pass only runs in a round with no click |
| lacoste | Didomi consent modal | not dismissed (race) | `[aria-label="Close"]` matches a promo bar's close button that never goes away, three rounds running; Didomi's accept is clicked only when it renders first |
| puma DE | "Standort wählen" location popup; OneTrust | not matched; OneTrust appears after dismissal ends | a section with no role, its button reads "Schließen". On one run "OK" matched the colour swatch "Rosy Outl**ook**": dismissal changed the selected variant |

## Legitimate expansions on these pages

The mejuri, puma and ikea accordions, skullcandy's `<details>`, and the kith, ikea and thomann
tabs. Every rule below keeps them.

Found along the way: on mejuri the two expand rounds toggle a single-open accordion so
"Materials & Specifications" ends closed; on thomann the tabs pass clicked a link that navigated
to a service page; on ikea the tabs pass clicks PDF document links.

## Rules the evidence supports

1. The expand pass never opens an overlay: skip controls with `aria-haspopup` (dialog, true,
   menu, listbox), controls whose `aria-controls` target is dialog-like, and anything inside an
   overlay; undo any click that opened one anyway.
2. Dismissal text selectors match the whole button name, never a substring.
3. Dismissal never clicks the same element twice and counts a click only if the element goes
   away; the JS removal pass runs every round.
4. Close the topmost blocking layer by a close-named button inside it (Close, Schließen, ×…).
5. Dismissal never clicks variant controls (swatches, `aria-pressed`, radios) or anything named
   settings, preferences or manage.
6. One more dismissal pass just before the screenshot, then scroll to the top.
