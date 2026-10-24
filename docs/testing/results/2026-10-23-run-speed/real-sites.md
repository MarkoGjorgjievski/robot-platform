# Real pages, read only — today's capture vs lean (spec 2026-10-23 run speed §5.4)

15 pages, 0 errors. Median today 11827 ms, lean 12180 ms (wall time of each extraction, the domain lock's politeness wait included). Lean took: lean 5, lean+full 10, full 0; pages whose lean read disagreed with its own full capture (would switch a run): 0. Pages with a value difference: 0 (of them written by lean: 0); with a shown difference: 0. Chromium peak 1049 MB.

## Per site

| Site | Pages | Errors | Today median ms | Lean median ms | lean / lean+full / full | Value-diff pages | Shown-diff pages |
|---|---|---|---|---|---|---|---|
| www.ikea.com | 5 | 0 | 12805 | 16120 | 0 / 5 / 0 | 0 | 0 |
| www.gymshark.com | 5 | 0 | 10423 | 5308 | 5 / 0 / 0 | 0 | 0 |
| www.skullcandy.com | 5 | 0 | 8020 | 12180 | 0 / 5 / 0 | 0 | 0 |

## Per page

| Site | Page | Order | Today ms | Lean ms | Lean capture ms | Lean took | Switch | Values | Shown |
|---|---|---|---|---|---|---|---|---|---|
| www.ikea.com | /my/en/p/soederhamn-3-seat-sofa-with-open-end-kelinge-beige-s89622109/ | today-first | 15639 | 16120 | 5595 | lean+full:unshown [title, description] | — | same | same |
| www.ikea.com | /my/en/p/vimle-3-seat-sofa-with-chaise-longue-with-wide-armrests-knaebaeck-grey-green-s69635037/ | lean-first | 12119 | 16812 | 6002 | lean+full:unshown [title, description] | — | same | same |
| www.ikea.com | /my/en/p/soederhamn-4-seat-sofa-with-chaise-longue-and-open-end-kelinge-beige-s99621675/ | today-first | 12805 | 16099 | 5393 | lean+full:unshown [title, description] | — | same | same |
| www.ikea.com | /my/en/p/lillesaeter-4-seat-sofa-gunnared-bright-green-yellow-s49614272/ | lean-first | 12311 | 18443 | 8040 | lean+full:unshown [title, rating, description] | — | same | same |
| www.ikea.com | /my/en/p/landskrona-three-seat-sofa-grann-bomstad-black-metal-s79031701/ | today-first | 12871 | 15945 | 5481 | lean+full:unshown [title, description] | — | same | same |
| www.gymshark.com | /products/gymshark-whitney-mid-rise-legging-leggings-black-ss26 | today-first | 12809 | 4892 | 4811 | lean | — | same | same |
| www.gymshark.com | /products/gymshark-everyday-seamless-leggings-leggings-pink-aw26 | lean-first | 9017 | 7822 | 7748 | lean | — | same | same |
| www.gymshark.com | /products/gymshark-everyday-seamless-flared-leggings-leggings-blue-aw26-b4b8h-uctn | today-first | 11827 | 4899 | 4824 | lean | — | same | same |
| www.gymshark.com | /products/gymshark-everyday-seamless-shorts-shorts-brown-aw26 | lean-first | 7916 | 8693 | 8613 | lean | — | same | same |
| www.gymshark.com | /products/gymshark-everyday-seamless-shorts-black-aw23 | today-first | 10423 | 5308 | 5223 | lean | — | same | same |
| www.skullcandy.com | /products/crusher-plyr-720-gaming-headphones | today-first | 12166 | 12180 | 4410 | lean+full:unshown [sku, brand] | — | same | same |
| www.skullcandy.com | /products/icon-anc | lean-first | 7082 | 13047 | 6183 | lean+full:unshown [sku, brand] | — | same | same |
| www.skullcandy.com | /products/hesh-360-wireless-headphones | today-first | 7618 | 10173 | 3538 | lean+full:unshown [sku, brand] | — | same | same |
| www.skullcandy.com | /products/hesh-540-anc-noise-canceling-headphones | lean-first | 8020 | 11626 | 4417 | lean+full:unshown [sku, brand] | — | same | same |
| www.skullcandy.com | /products/aviator-900-anc-headphones | today-first | 10206 | 13697 | 5340 | lean+full:unshown [sku, brand] | — | same | same |

## Every difference, verbatim

None.

## Run-like pass (one lean state per site, its 2 check items first)

- **www.ikea.com**: run run-like: lean 1, lean+full 3 (check 2, miss 0, unshown 1, verdict 0), full 0
  - /my/en/p/soederhamn-3-seat-sofa-with-open-end-kelinge-beige-s89622109/: lean+full:check
  - /my/en/p/vimle-3-seat-sofa-with-chaise-longue-with-wide-armrests-knaebaeck-grey-green-s69635037/: lean+full:check
  - /my/en/p/soederhamn-4-seat-sofa-with-chaise-longue-and-open-end-kelinge-beige-s99621675/: error: ikea.com could not be reached (no response).
  - /my/en/p/lillesaeter-4-seat-sofa-gunnared-bright-green-yellow-s49614272/: lean+full:unshown [title, rating, description]
  - /my/en/p/landskrona-three-seat-sofa-grann-bomstad-black-metal-s79031701/: lean
- **www.gymshark.com**: run run-like: lean 3, lean+full 2 (check 2, miss 0, unshown 0, verdict 0), full 0
  - /products/gymshark-whitney-mid-rise-legging-leggings-black-ss26: lean+full:check
  - /products/gymshark-everyday-seamless-leggings-leggings-pink-aw26: lean+full:check
  - /products/gymshark-everyday-seamless-flared-leggings-leggings-blue-aw26-b4b8h-uctn: lean
  - /products/gymshark-everyday-seamless-shorts-shorts-brown-aw26: lean
  - /products/gymshark-everyday-seamless-shorts-black-aw23: lean
- **www.skullcandy.com**: run run-like: lean 2, lean+full 3 (check 2, miss 0, unshown 1, verdict 0), full 0
  - /products/crusher-plyr-720-gaming-headphones: lean+full:check
  - /products/icon-anc: lean+full:check
  - /products/hesh-360-wireless-headphones: lean+full:unshown [sku, brand]
  - /products/hesh-540-anc-noise-canceling-headphones: lean
  - /products/aviator-900-anc-headphones: lean

## Reading (written by hand after the run, 2026-10-24)

- **No value and no shown difference on any page**, the 5 Gymshark pages written lean included, and none in the run-like pass (6 more items written lean: Ikea 1, Gymshark 3, Skullcandy 2). No lean read disagreed with its own full capture, so nothing switched: no `switched` reason, no live-probe vs re-rendered text mismatch.
- **Every Ikea and Skullcandy page fell back (`lean+full:unshown`)** — Ikea on `title`, `description` (and `rating` on one page), Skullcandy on `sku`, `brand`. Today's full capture reads the same fields as not shown on the same pages (`today.shown` in the JSON: Ikea title/description false, Skullcandy sku/brand false), so these fallbacks rescue nothing: the full capture confirms the field is not on the page's text. With the per-page fresh state this check uses (past its check items, no confirmations yet) every page pays both captures, which is why lean is slower than today there (Ikea 16.1 s vs 12.8 s, Skullcandy 12.2 s vs 8.0 s median).
- **In a run those fallbacks stop after three confirmations** (spec §3.4): the run-like pass shows it — Ikea's 5th item and Skullcandy's 4th and 5th were written lean (lean capture 4.0 s Ikea; 3.8 s and 5.8 s Skullcandy, vs today's ~11.5 s and ~7–10 s). The per-page table's lean times for those two sites measure the first-sight cost, not a run's steady state.
- Gymshark: lean on every page, median 5.3 s vs 10.4 s today.
- One run-like Ikea item failed with `ikea.com could not be reached (no response)` (`ERR_NAME_NOT_RESOLVED`, a DNS blip on this machine); the same URL captured fine both ways minutes earlier.
