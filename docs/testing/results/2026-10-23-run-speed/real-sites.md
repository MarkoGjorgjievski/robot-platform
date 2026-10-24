# Real pages, read only — today's capture vs lean (spec 2026-10-23 run speed §5.4)

15 pages, 0 errors. Median today 8272 ms, lean 9475 ms (wall time of each extraction, the domain lock's politeness wait included). Lean took: lean 5, lean+full 10, full 0; pages whose lean read disagreed with its own full capture (would switch a run): 0. Pages with a value difference: 0 (of them written by lean: 0); with a shown difference: 0. Chromium peak 1164 MB.

## Per site

| Site | Pages | Errors | Today median ms | Lean median ms | lean / lean+full / full | Value-diff pages | Shown-diff pages |
|---|---|---|---|---|---|---|---|
| www.ikea.com | 5 | 0 | 8272 | 9475 | 0 / 5 / 0 | 0 | 0 |
| www.gymshark.com | 5 | 0 | 10176 | 5332 | 5 / 0 / 0 | 0 | 0 |
| www.skullcandy.com | 5 | 0 | 7897 | 11045 | 0 / 5 / 0 | 0 | 0 |

## Per page

| Site | Page | Order | Today ms | Lean ms | Lean capture ms | Lean took | Switch | Values | Shown |
|---|---|---|---|---|---|---|---|---|---|
| www.ikea.com | /my/en/p/soederhamn-3-seat-sofa-with-open-end-kelinge-beige-s89622109/ | today-first | 11887 | 8440 | 2141 | lean+full:unshown [title, description] | — | same | same |
| www.ikea.com | /my/en/p/vimle-3-seat-sofa-with-chaise-longue-with-wide-armrests-knaebaeck-grey-green-s69635037/ | lean-first | 7690 | 13000 | 5899 | lean+full:unshown [title, description] | — | same | same |
| www.ikea.com | /my/en/p/soederhamn-4-seat-sofa-with-chaise-longue-and-open-end-kelinge-beige-s99621675/ | today-first | 8272 | 8974 | 2224 | lean+full:unshown [title, description] | — | same | same |
| www.ikea.com | /my/en/p/lillesaeter-4-seat-sofa-gunnared-bright-green-yellow-s49614272/ | lean-first | 7465 | 11059 | 5022 | lean+full:unshown [title, rating, description] | — | same | same |
| www.ikea.com | /my/en/p/landskrona-three-seat-sofa-grann-bomstad-black-metal-s79031701/ | today-first | 8857 | 9475 | 2235 | lean+full:unshown [title, description] | — | same | same |
| www.gymshark.com | /products/gymshark-whitney-mid-rise-legging-leggings-black-ss26 | today-first | 12852 | 4644 | 4551 | lean | — | same | same |
| www.gymshark.com | /products/gymshark-everyday-seamless-leggings-leggings-pink-aw26 | lean-first | 7794 | 7889 | 7805 | lean | — | same | same |
| www.gymshark.com | /products/gymshark-everyday-seamless-flared-leggings-leggings-blue-aw26-b4b8h-uctn | today-first | 10273 | 5332 | 5249 | lean | — | same | same |
| www.gymshark.com | /products/gymshark-everyday-seamless-shorts-shorts-brown-aw26 | lean-first | 7415 | 6520 | 6436 | lean | — | same | same |
| www.gymshark.com | /products/gymshark-everyday-seamless-shorts-black-aw23 | today-first | 10176 | 4768 | 4676 | lean | — | same | same |
| www.skullcandy.com | /products/crusher-plyr-720-gaming-headphones | today-first | 12173 | 12253 | 4747 | lean+full:unshown [sku, brand] | — | same | same |
| www.skullcandy.com | /products/icon-anc | lean-first | 7430 | 9979 | 3437 | lean+full:unshown [sku, brand] | — | same | same |
| www.skullcandy.com | /products/hesh-360-wireless-headphones | today-first | 7614 | 9738 | 3213 | lean+full:unshown [sku, brand] | — | same | same |
| www.skullcandy.com | /products/hesh-540-anc-noise-canceling-headphones | lean-first | 7897 | 11045 | 3970 | lean+full:unshown [sku, brand] | — | same | same |
| www.skullcandy.com | /products/aviator-900-anc-headphones | today-first | 9928 | 13817 | 5235 | lean+full:unshown [sku, brand] | — | same | same |

## Every difference, verbatim

None.

## Run-like pass (one lean state per site, its 2 check items first)

- **www.ikea.com**: run run-like: lean 1, lean+full 4 (check 2, miss 0, unshown 2, verdict 0), full 0
  - /my/en/p/soederhamn-3-seat-sofa-with-open-end-kelinge-beige-s89622109/: lean+full:check
  - /my/en/p/vimle-3-seat-sofa-with-chaise-longue-with-wide-armrests-knaebaeck-grey-green-s69635037/: lean+full:check
  - /my/en/p/soederhamn-4-seat-sofa-with-chaise-longue-and-open-end-kelinge-beige-s99621675/: lean+full:unshown [title, description]
  - /my/en/p/lillesaeter-4-seat-sofa-gunnared-bright-green-yellow-s49614272/: lean+full:unshown [rating]
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

## Reading (written by hand after the re-run on the fix wave's head, 2026-10-24)

- Re-run on 78a9e4b3 because code changed after Task 7 (a9f05eb9; the fix wave). **No value and no shown difference on any page**, the 5 Gymshark pages written lean included, and none in the run-like pass (6 items written lean: Ikea 1, Gymshark 3, Skullcandy 2). No lean read disagreed with its own full capture, so nothing switched.
- **Every Ikea and Skullcandy page fell back (`lean+full:unshown`)** — Ikea on `title`, `description` (and `rating` on one page), Skullcandy on `sku`, `brand`. Today's full capture reads the same fields as not shown on the same pages (`today.shown` in the JSON), so these fallbacks rescue nothing. With the per-page fresh state this check uses every page pays both captures, which is why lean is slower than today there (Ikea 9.5 s vs 8.3 s, Skullcandy 11.0 s vs 7.9 s median).
- **In a run those fallbacks stop once confirmed** (spec §3.4): in the run-like pass Ikea's 5th item and Skullcandy's 4th and 5th were written lean (lean capture 3.0 s Ikea; 3.7 s and 5.0 s Skullcandy).
- Gymshark: lean on every page, median 5.3 s vs 10.2 s today.
- Against the first run (before the fix wave): the same modes page for page (lean 5, lean+full 10, full 0), the same unshown fields, 0/0 differences both times. Timings moved with the network (today median 11.8 s → 8.3 s; Ikea's today median 12.8 s → 8.3 s); the run-like Ikea item that failed on a DNS blip the first time captured fine (lean+full:unshown).
