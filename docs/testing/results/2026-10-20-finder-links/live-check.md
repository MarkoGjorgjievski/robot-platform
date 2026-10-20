# The finder reads product links — free live check

Run 2026-10-20T12:41:55.864Z by `live-check.mts` (this folder): one Chromium, one page at a time, no model. Before: the rule on `main` before this branch (C:/Users/Marko/Documents/projects/robot-platform). After: `readListingPage` (bounded loading) + `findProductGroup`. Screenshots: `live/<site>.png` (the zero cases are committed).

| Site | Products on the page (spec §2) | Finder before | Finder after | Shape after | First products after | ms |
|---|---|---|---|---|---|---|
| bombas | 27 /products/* | 112 links / 96 paths | 73 (27 on cards) | `bombas.com/products/*` | `/products/mens-merino-wool-socks?variant=rouge`<br>`/products/mens-merino-wool-sock-4-pack?variant=rouge-green-mix`<br>`/products/mens-classic-marls-ankle?variant=slate-sea` | 24306 |
| burrow | 25 | 5 links / 5 paths | 25 (25 on cards) | `burrow.com/products/*` | `/products/shift-sleeper-sofa?Fabric=Heather+Charcoal+-+Performance+Basketweave`<br>`/products/span-sleeper-sofa?Fabric=Georgia+Clay+-+Performance+Chenille`<br>`/products/union-3-seat-sofa?Fabric=Heather+Charcoal+-+Performance+Chenille&Leg+Finish=Oak+-+Wood&Leg+Style=Round+Leg` | 88122 |
| thomann-cat | a category hub (99 acceptable, §7) | 6 links / 6 paths | 93 (93 on cards) | `thomann.de/de/*.htm` | `/de/neural_dsp_quad_cortex.htm`<br>`/de/harley_benton_st_20hss_sbk_standard_series.htm`<br>`/de/thomann_nt_0910.htm` | 12833 |
| thomann | 51 (/de/*.htm) | 8 links / 8 paths | 100 (100 on cards) | `thomann.de/de/*.htm` | `/de/yamaha_c40_konzertgitarre.htm?type=category`<br>`/de/startone_cg_851_44.htm?type=category`<br>`/de/harley_benton_santos_series_c_40sce_n_w_bag.htm` | 17515 |
| lacoste | 13 | 20 links / 4 paths | 13 (13 on cards) | `lacoste.com/gb/lacoste/men/clothing/*/*/*.html` | `/gb/lacoste/men/clothing/polo-shirts/short-sleeves/L1212-00.html?color=02S`<br>`/gb/lacoste/men/clothing/polo-shirts/long-sleeve/L1312-00.html?color=166`<br>`/gb/lacoste/men/clothing/polo-shirts/long-sleeve/PH2481-00.html?color=166` | 39311 |
| ikea | 52 priced cards | 29 links / 29 paths | 91 (16 on cards) | `ikea.com/my/en/p/*` | `/my/en/p/glostad-3-seat-sofa-knisa-dark-grey-40595937/`<br>`/my/en/p/glostad-3-seat-sofa-knisa-medium-blue-30595933/`<br>`/my/en/p/glostad-2-seat-sofa-knisa-dark-grey-10489009/` | 14118 |
| ikea-blog | 0 | 2 links / 2 paths | **no products** | `ItemList` |  | 10088 |
| noths | 60 /{seller}/product/* | 34 links / 34 paths | 60 (60 on cards) | `notonthehighstreet.com/*/product/*` | `/lisaangeljewellery/product/personalised-men-s-stainless-steel-plaque-bracelet`<br>`/lisaangeljewellery/product/men-s-personalised-leather-bracelet-with-matt-clasp`<br>`/lisaangeljewellery/product/sunshine-jewellery-stand-with-terrazzo-base` | 31653 |
| ruggable | 47 | 63 links / 61 paths | 47 (47 on cards) | `ruggable.com/products/*` | `/products/sierra-ivory-opal-tufted-rug?size=6x9&system=rug-cvr`<br>`/products/sundara-brown-olive-tufted-rug?size=6x9&system=rug-cvr`<br>`/products/cyrus-rose-gold-tufted-rug?size=6x9&system=rug-cvr` | 43064 |
| skullcandy | 41 | 39 links / 13 paths | 41 (39 on cards) | `skullcandy.com/products/*` | `/products/crusher-540-active`<br>`/products/dime-360`<br>`/products/crusher-anc-2-sensory-bass-headphones-with-active-noise-canceling` | 53838 |
| puma | 14 | 19 links / 10 paths | 30 (30 on cards) | `us.puma.com/us/en/pd/*/*` | `/us/en/pd/speedcat-og-sneakers/398846?swatch=01`<br>`/us/en/pd/speedcat-dressed-sneakers/407829?swatch=01`<br>`/us/en/pd/puma-x-street-fighter-suede-ryu-sneakers/410647?swatch=01` | 42937 |
| gymshark | colours are separate pages (§7) | 104 links / 104 paths | 124 (124 on cards) | `gymshark.com/products/*` | `/products/gymshark-everyday-seamless-leggings-leggings-brown-aw26`<br>`/products/gymshark-minimal-sports-bra-2-0-sports-bras-black-aw26`<br>`/products/gymshark-everyday-seamless-flared-legging-leggings-black-aw25` | 37300 |
| ridge | 0 | 3 links / 3 paths | **no products** | `ItemList` |  | 32361 |

## Before, first links

- bombas: `/collections/new-releases`, `/collections/womens-performance-socks`, `/collections/mens-ankle-socks`
- burrow: `/products/range-plus-3-piece-one-arm-sofa-with-table?Fabric=Moss+Green+-+Performance+Flatweave&Leg+Table+Finish=Oak+Legs+and+Table`, `/products/range-plus-3-piece-one-arm-sofa?Fabric=Moss+Green+-+Performance+Flatweave&Leg+Finish=Black+-+Metal`, `/products/range-plus-4-piece-one-arm-sofa-lounger?Fabric=Moss+Green+-+Performance+Flatweave&Leg+Finish=Black+-+Metal`
- thomann-cat: `/de/konzertgitarren.html`, `/de/westerngitarren.html`, `/de/akustikbaesse.html`
- thomann: `/de/tasteninstrumente.html`, `/de/pa-beschallungsequipment.html`, `/de/licht-buehnenequipment.html`
- lacoste: `/gb/lacoste/men/clothing/polo-shirts/short-sleeves/PH5522-00.html?color=031`, `/gb/lacoste/men/clothing/polo-shirts/short-sleeves/PH5522-00.html?color=001`, `/gb/lacoste/men/clothing/polo-shirts/short-sleeves/PH5522-00.html?color=166`
- ikea: `/my/en/cat/sofas-armchairs-700640/`, `/my/en/cat/two-seater-sofas-10668/`, `/my/en/cat/three-seater-sofas-10670/`
- ikea-blog: `/global/en/our-business/`, `/global/en/international-sales/`
- noths: `/christmas/christmas-gifts/stocking-fillers`, `/christmas/christmas-decorations/garlands-bunting`, `/christmas/christmas-home/table-decorations`
- ruggable: `/products/sierra-ivory-opal-tufted-rug?size=6x9&system=rug-cvr`, `/products/sierra-soft-black-tufted-rug`, `/products/sundara-brown-olive-tufted-rug?size=6x9&system=rug-cvr`
- skullcandy: `/products/crusher-evo-sensory-bass-headphones-with-personal-sound`, `/products/crusher-evo-sensory-bass-headphones-with-personal-sound?variant=45061353865273`, `/products/crusher-evo-sensory-bass-headphones-with-personal-sound?variant=45242474037305`
- puma: `/us/en/pd/speedcat-og-sneakers/398846?swatch=01`, `/us/en/pd/speedcat-og-sneakers/398846?swatch=31`, `/us/en/pd/speedcat-og-sneakers/398846?swatch=93`
- gymshark: `/products/gymshark-everyday-seamless-leggings-leggings-brown-aw26`, `/products/gymshark-everyday-seamless-flared-legging-leggings-black-aw25`, `/products/gymshark-everyday-seamless-leggings-leggings-purple-aw25`
- ridge: `/pages/privacy-policy`, `/pages/terms-of-service`, `/pages/warranty-policy`

## Zero cases (screenshots looked at)

- ikea-blog — `live/ikea-blog.png`; final URL https://www.ikea.com/global/en/stories/ideas-inspiration/style-report-modern-nordic-warmth-260617/; 25 links, 0 ItemList items. LOOKED: a "Style report" editorial article ("Modern Nordic warmth") — a headline, two paragraphs of copy and one lifestyle photo; no product cards, no prices, no shop links in the tile; the 25 links are nav/footer/utility links. Correctly zero.
- ridge — `live/ridge.png`; final URL https://ridge.com/collections/wallets; 94 links, 0 ItemList items. LOOKED: a wallet collection page — the first tile shows only category-tile buttons (MagSafe Wallets, Wallet Sets, New & Limited, NFL, Collegiate, MLB), a "Filter + Sort" bar reading "117 Results", and a "LOAD MORE" button; no product cards are present in the DOM yet (94 links are all nav/footer/utility), so there is nothing to find until "Load More" runs client-side. Correctly zero, matching the spec's own expectation for this page.

## Read against the spec

Every "after" example above is a genuine product-detail link (no `/collections/`, `/cat/`, `/pages/`, `/policies/`, language or blog links turned up in any site's top 3, and no two examples share one product's slug with only the colour query differing). Compared to the spec §2 table:

- burrow (25→25), lacoste (13→13), noths (60→60), ruggable (47→47) and skullcandy (41, 39 on cards) land on or within a couple of the spec's count.
- thomann-cat (93, spec "99 acceptable §7") and puma (30 vs spec 14, final URL `?offset=48` shows a second load-more round ran) and thomann (100 vs spec 51, final URL `?pg=2&ls=50…` shows the bounded loader pulled in a second page) are all higher after loading, which the brief says is fine — the loader is doing its job, pulling in more of the same shape rather than anything off-shape.
- gymshark (124) matches the spec's note directly: colours are separate product pages on this site, so a higher count than a naive per-style count is correct, not inflation.
- bombas: carded (27) matches the spec's 27 exactly; the total (73) is higher because `findProductGroup` also includes same-shape `/products/*` links outside the card grid (e.g. a "complete the look" rail) per its documented "below budget" behaviour (`product-link-group.ts`) — not a bug, but worth knowing the headline "73" overstates what's on the visible grid; "27 on cards" is the number to compare against the spec.
- ikea: carded (16) is well short of the spec's "52 priced cards" — the first screenshot tile (`live/ikea.png`) lands on a shoppable-photo module with hotspot pins, not the priced grid, which sits further down the page; the DOM-wide link read still reaches it (91 total, 24 of those corroborated by the page's own ItemList), and the 3 examples are genuine distinct SKUs (colour variants each get their own IKEA product id, so they count as separate products by the "one product, one path" rule). The low carded count suggests `onCard`'s MYR price match is missing a chunk of the real priced cards even though the final answer is still complete via the ItemList corroboration path — not a stop-the-line failure (no off-shape link appears, zero cases are unaffected), but a candidate for a closer look in a follow-up task if `carded` is ever used as a confidence signal on its own.
- ridge and ikea-blog read zero, matching the spec exactly (see screenshots above).

No after-list held a non-product link, and no page with a visible product grid in its first tile read zero, so step 3's stop condition was not hit.

## Raw

```json
[
  {
    "site": "bombas",
    "url": "https://bombas.com/collections/mens-socks",
    "onPage": "27 /products/*",
    "before": {
      "n": 112,
      "paths": 96,
      "examples": [
        "/collections/new-releases",
        "/collections/womens-performance-socks",
        "/collections/mens-ankle-socks"
      ]
    },
    "after": {
      "n": 73,
      "carded": 27,
      "shape": "bombas.com/products/*",
      "examples": [
        "/products/mens-merino-wool-socks?variant=rouge",
        "/products/mens-merino-wool-sock-4-pack?variant=rouge-green-mix",
        "/products/mens-classic-marls-ankle?variant=slate-sea"
      ],
      "verdict": "ok",
      "finalUrl": "https://bombas.com/collections/mens-socks",
      "anchors": 484,
      "itemList": 0,
      "ms": 24306
    }
  },
  {
    "site": "burrow",
    "url": "https://burrow.com/collections/sofas",
    "onPage": "25",
    "before": {
      "n": 5,
      "paths": 5,
      "examples": [
        "/products/range-plus-3-piece-one-arm-sofa-with-table?Fabric=Moss+Green+-+Performance+Flatweave&Leg+Table+Finish=Oak+Legs+and+Table",
        "/products/range-plus-3-piece-one-arm-sofa?Fabric=Moss+Green+-+Performance+Flatweave&Leg+Finish=Black+-+Metal",
        "/products/range-plus-4-piece-one-arm-sofa-lounger?Fabric=Moss+Green+-+Performance+Flatweave&Leg+Finish=Black+-+Metal"
      ]
    },
    "after": {
      "n": 25,
      "carded": 25,
      "shape": "burrow.com/products/*",
      "examples": [
        "/products/shift-sleeper-sofa?Fabric=Heather+Charcoal+-+Performance+Basketweave",
        "/products/span-sleeper-sofa?Fabric=Georgia+Clay+-+Performance+Chenille",
        "/products/union-3-seat-sofa?Fabric=Heather+Charcoal+-+Performance+Chenille&Leg+Finish=Oak+-+Wood&Leg+Style=Round+Leg"
      ],
      "verdict": "ok",
      "finalUrl": "https://burrow.com/collections/shop-all-sofas",
      "anchors": 305,
      "itemList": 0,
      "ms": 88122
    }
  },
  {
    "site": "thomann-cat",
    "url": "https://www.thomann.de/de/gitarren_baesse.html",
    "onPage": "a category hub (99 acceptable, §7)",
    "before": {
      "n": 6,
      "paths": 6,
      "examples": [
        "/de/konzertgitarren.html",
        "/de/westerngitarren.html",
        "/de/akustikbaesse.html"
      ]
    },
    "after": {
      "n": 93,
      "carded": 93,
      "shape": "thomann.de/de/*.htm",
      "examples": [
        "/de/neural_dsp_quad_cortex.htm",
        "/de/harley_benton_st_20hss_sbk_standard_series.htm",
        "/de/thomann_nt_0910.htm"
      ],
      "verdict": "ok",
      "finalUrl": "https://www.thomann.de/de/gitarren_baesse.html",
      "anchors": 274,
      "itemList": 0,
      "ms": 12833
    }
  },
  {
    "site": "thomann",
    "url": "https://www.thomann.de/de/4-4_konzertgitarren.html",
    "onPage": "51 (/de/*.htm)",
    "before": {
      "n": 8,
      "paths": 8,
      "examples": [
        "/de/tasteninstrumente.html",
        "/de/pa-beschallungsequipment.html",
        "/de/licht-buehnenequipment.html"
      ]
    },
    "after": {
      "n": 100,
      "carded": 100,
      "shape": "thomann.de/de/*.htm",
      "examples": [
        "/de/yamaha_c40_konzertgitarre.htm?type=category",
        "/de/startone_cg_851_44.htm?type=category",
        "/de/harley_benton_santos_series_c_40sce_n_w_bag.htm"
      ],
      "verdict": "ok",
      "finalUrl": "https://www.thomann.de/de/4-4_konzertgitarren.html?pg=2&ls=50&gk=GIKO44&cme=true",
      "anchors": 297,
      "itemList": 0,
      "ms": 17515
    }
  },
  {
    "site": "lacoste",
    "url": "https://www.lacoste.com/gb/lacoste/men/clothing/polo-shirts/",
    "onPage": "13",
    "before": {
      "n": 20,
      "paths": 4,
      "examples": [
        "/gb/lacoste/men/clothing/polo-shirts/short-sleeves/PH5522-00.html?color=031",
        "/gb/lacoste/men/clothing/polo-shirts/short-sleeves/PH5522-00.html?color=001",
        "/gb/lacoste/men/clothing/polo-shirts/short-sleeves/PH5522-00.html?color=166"
      ]
    },
    "after": {
      "n": 13,
      "carded": 13,
      "shape": "lacoste.com/gb/lacoste/men/clothing/*/*/*.html",
      "examples": [
        "/gb/lacoste/men/clothing/polo-shirts/short-sleeves/L1212-00.html?color=02S",
        "/gb/lacoste/men/clothing/polo-shirts/long-sleeve/L1312-00.html?color=166",
        "/gb/lacoste/men/clothing/polo-shirts/long-sleeve/PH2481-00.html?color=166"
      ],
      "verdict": "ok",
      "finalUrl": "https://www.lacoste.com/gb/lacoste/men/clothing/polo-shirts/",
      "anchors": 542,
      "itemList": 0,
      "ms": 39311
    }
  },
  {
    "site": "ikea",
    "url": "https://www.ikea.com/my/en/cat/sofas-fu003/",
    "onPage": "52 priced cards",
    "before": {
      "n": 29,
      "paths": 29,
      "examples": [
        "/my/en/cat/sofas-armchairs-700640/",
        "/my/en/cat/two-seater-sofas-10668/",
        "/my/en/cat/three-seater-sofas-10670/"
      ]
    },
    "after": {
      "n": 91,
      "carded": 16,
      "shape": "ikea.com/my/en/p/*",
      "examples": [
        "/my/en/p/glostad-3-seat-sofa-knisa-dark-grey-40595937/",
        "/my/en/p/glostad-3-seat-sofa-knisa-medium-blue-30595933/",
        "/my/en/p/glostad-2-seat-sofa-knisa-dark-grey-10489009/"
      ],
      "verdict": "ok",
      "finalUrl": "https://www.ikea.com/my/en/cat/sofas-fu003/",
      "anchors": 448,
      "itemList": 24,
      "ms": 14118
    }
  },
  {
    "site": "ikea-blog",
    "url": "https://www.ikea.com/global/en/stories/ideas-inspiration/style-report-modern-nordic-warmth-260617/",
    "onPage": "0",
    "before": {
      "n": 2,
      "paths": 2,
      "examples": [
        "/global/en/our-business/",
        "/global/en/international-sales/"
      ]
    },
    "after": {
      "n": 0,
      "carded": 0,
      "shape": null,
      "examples": [],
      "verdict": "ok",
      "finalUrl": "https://www.ikea.com/global/en/stories/ideas-inspiration/style-report-modern-nordic-warmth-260617/",
      "anchors": 25,
      "itemList": 0,
      "ms": 10088
    }
  },
  {
    "site": "noths",
    "url": "https://www.notonthehighstreet.com/sale/jewellery-sale",
    "onPage": "60 /{seller}/product/*",
    "before": {
      "n": 34,
      "paths": 34,
      "examples": [
        "/christmas/christmas-gifts/stocking-fillers",
        "/christmas/christmas-decorations/garlands-bunting",
        "/christmas/christmas-home/table-decorations"
      ]
    },
    "after": {
      "n": 60,
      "carded": 60,
      "shape": "notonthehighstreet.com/*/product/*",
      "examples": [
        "/lisaangeljewellery/product/personalised-men-s-stainless-steel-plaque-bracelet",
        "/lisaangeljewellery/product/men-s-personalised-leather-bracelet-with-matt-clasp",
        "/lisaangeljewellery/product/sunshine-jewellery-stand-with-terrazzo-base"
      ],
      "verdict": "ok",
      "finalUrl": "https://www.notonthehighstreet.com/sale/jewellery-sale",
      "anchors": 1124,
      "itemList": 60,
      "ms": 31653
    }
  },
  {
    "site": "ruggable",
    "url": "https://ruggable.com/collections/shop-all",
    "onPage": "47",
    "before": {
      "n": 63,
      "paths": 61,
      "examples": [
        "/products/sierra-ivory-opal-tufted-rug?size=6x9&system=rug-cvr",
        "/products/sierra-soft-black-tufted-rug",
        "/products/sundara-brown-olive-tufted-rug?size=6x9&system=rug-cvr"
      ]
    },
    "after": {
      "n": 47,
      "carded": 47,
      "shape": "ruggable.com/products/*",
      "examples": [
        "/products/sierra-ivory-opal-tufted-rug?size=6x9&system=rug-cvr",
        "/products/sundara-brown-olive-tufted-rug?size=6x9&system=rug-cvr",
        "/products/cyrus-rose-gold-tufted-rug?size=6x9&system=rug-cvr"
      ],
      "verdict": "ok",
      "finalUrl": "https://ruggable.com/collections/shop-all",
      "anchors": 420,
      "itemList": 47,
      "ms": 43064
    }
  },
  {
    "site": "skullcandy",
    "url": "https://www.skullcandy.com/collections/shop-all",
    "onPage": "41",
    "before": {
      "n": 39,
      "paths": 13,
      "examples": [
        "/products/crusher-evo-sensory-bass-headphones-with-personal-sound",
        "/products/crusher-evo-sensory-bass-headphones-with-personal-sound?variant=45061353865273",
        "/products/crusher-evo-sensory-bass-headphones-with-personal-sound?variant=45242474037305"
      ]
    },
    "after": {
      "n": 41,
      "carded": 39,
      "shape": "skullcandy.com/products/*",
      "examples": [
        "/products/crusher-540-active",
        "/products/dime-360",
        "/products/crusher-anc-2-sensory-bass-headphones-with-active-noise-canceling"
      ],
      "verdict": "ok",
      "finalUrl": "https://www.skullcandy.com/collections/shop-all",
      "anchors": 620,
      "itemList": 0,
      "ms": 53838
    }
  },
  {
    "site": "puma",
    "url": "https://us.puma.com/us/en/men/shoes",
    "onPage": "14",
    "before": {
      "n": 19,
      "paths": 10,
      "examples": [
        "/us/en/pd/speedcat-og-sneakers/398846?swatch=01",
        "/us/en/pd/speedcat-og-sneakers/398846?swatch=31",
        "/us/en/pd/speedcat-og-sneakers/398846?swatch=93"
      ]
    },
    "after": {
      "n": 30,
      "carded": 30,
      "shape": "us.puma.com/us/en/pd/*/*",
      "examples": [
        "/us/en/pd/speedcat-og-sneakers/398846?swatch=01",
        "/us/en/pd/speedcat-dressed-sneakers/407829?swatch=01",
        "/us/en/pd/puma-x-street-fighter-suede-ryu-sneakers/410647?swatch=01"
      ],
      "verdict": "ok",
      "finalUrl": "https://us.puma.com/us/en/men/shoes?offset=48",
      "anchors": 344,
      "itemList": 48,
      "ms": 42937
    }
  },
  {
    "site": "gymshark",
    "url": "https://www.gymshark.com/collections/all-products/womens",
    "onPage": "colours are separate pages (§7)",
    "before": {
      "n": 104,
      "paths": 104,
      "examples": [
        "/products/gymshark-everyday-seamless-leggings-leggings-brown-aw26",
        "/products/gymshark-everyday-seamless-flared-legging-leggings-black-aw25",
        "/products/gymshark-everyday-seamless-leggings-leggings-purple-aw25"
      ]
    },
    "after": {
      "n": 124,
      "carded": 124,
      "shape": "gymshark.com/products/*",
      "examples": [
        "/products/gymshark-everyday-seamless-leggings-leggings-brown-aw26",
        "/products/gymshark-minimal-sports-bra-2-0-sports-bras-black-aw26",
        "/products/gymshark-everyday-seamless-flared-legging-leggings-black-aw25"
      ],
      "verdict": "ok",
      "finalUrl": "https://www.gymshark.com/collections/all-products/womens?page=1",
      "anchors": 526,
      "itemList": 0,
      "ms": 37300
    }
  },
  {
    "site": "ridge",
    "url": "https://ridge.com/collections/wallets",
    "onPage": "0",
    "before": {
      "n": 3,
      "paths": 3,
      "examples": [
        "/pages/privacy-policy",
        "/pages/terms-of-service",
        "/pages/warranty-policy"
      ]
    },
    "after": {
      "n": 0,
      "carded": 0,
      "shape": null,
      "examples": [],
      "verdict": "ok",
      "finalUrl": "https://ridge.com/collections/wallets",
      "anchors": 94,
      "itemList": 0,
      "ms": 32361
    }
  }
]
```
