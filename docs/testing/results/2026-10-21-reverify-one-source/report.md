
### Credit campaign 2026-10/Credit campaign 2026-10/Barnesandnoble

Verification `f02b3ec6-3bca-4658-a14c-94873172412f`: **not passed** — Rating, Description

| Field | Sources before → after | Paths before → after | First path before | First path after | Changed | Outcome |
|---|---|---|---|---|---|---|
| Price | json-ld → json-ld | 2 → 1 | `json-ld @graph[1].offers.price` | `json-ld @graph[0].hasVariant[2].offers.price` | **yes** | passed |
| In stock | json-ld → json-ld | 5 → 2 | `json-ld @graph[1].offers.availability` | `json-ld @graph[1].offers.availability` | no | passed |
| Description | json-ld → — | 5 → 0 | `json-ld @graph[0].description` | (none) | **yes** | **failed** |

### Credit campaign 2026-10/Credit campaign 2026-10/Allbirds

Verification `c20dece8-a5e9-4a40-b7f5-79d677bd072e`: **passed**

| Field | Sources before → after | Paths before → after | First path before | First path after | Changed | Outcome |
|---|---|---|---|---|---|---|
| Main image | json-ld → json-ld+meta+xpath | 5 → 5 | `json-ld image[0]` | `json-ld image[0]` | no | passed |
| SKU | json-ld → json-ld | 2 → 2 | `json-ld sku` | `json-ld sku` | no | passed |

### Mar/Competitor prices/Ikea

Verification `2e51ed79-d3c4-44de-96a5-d313ba299f2c`: **not passed** — Price, Main image

| Field | Sources before → after | Paths before → after | First path before | First path after | Changed | Outcome |
|---|---|---|---|---|---|---|
| Product URL | api → api | 5 → 1 | `api pipUrl` | `api pipUrl @ https://www.ikea.com/my/en/products/882/70483882.json` | no | passed |
| Price | api → — | 5 → 0 | `api price` | (none) | **yes** | **failed** |
| In stock | api → json-ld | 5 → 1 | `api priority` | `json-ld offers.availability` | **yes** | passed |

### Credit campaign 2026-10/Credit campaign 2026-10/Nike

Verification `6a24794a-c745-4146-bb3c-e7d369a627ea`: **passed**

| Field | Sources before → after | Paths before → after | First path before | First path after | Changed | Outcome |
|---|---|---|---|---|---|---|
| Main image | json-ld → json-ld | 5 → 2 | `json-ld hasVariant[0].image` | `json-ld hasVariant[0].image` | no | passed |

### Markodjordjievski/Acne/Ikea

Verification `fe7a78ad-3d6b-4db0-904d-169a654915c1`: **not passed** — Total reviews, Average rating

| Field | Sources before → after | Paths before → after | First path before | First path after | Changed | Outcome |
|---|---|---|---|---|---|---|
| Price | api → api | 5 → 2 | `api price` | `api price @ https://www.ikea.com/my/en/products/009/10489009.json` | no | passed |
| Price currency | api → api | 2 → 2 | `api revampPrice.currencyPrefix` | `api revampPrice.currencyPrefix @ https://www.ikea.com/my/en/products/009/10489009.json` | no | passed |
| Product id | json-ld → json-ld+xpath | 2 → 4 | `json-ld mpn` | `json-ld mpn` | no | passed |

### Credit campaign 2026-10/Campaign 2 2026-10-11/Bombas

Verification `5070de0e-25ff-4ed9-91fb-4dd4a2ede5d1`: **not passed** — Price, Rating

| Field | Sources before → after | Paths before → after | First path before | First path after | Changed | Outcome |
|---|---|---|---|---|---|---|
| Main image | json-ld → json-ld | 2 → 2 | `json-ld image[0]` | `json-ld image[0]` | no | passed |

### Credit campaign 2026-10/Credit campaign 2026-10/Madeincookware

Verification `a69a5ede-386e-4f6e-8c88-492c4172e96c`: **not passed** — Price, SKU

| Field | Sources before → after | Paths before → after | First path before | First path after | Changed | Outcome |
|---|---|---|---|---|---|---|
| SKU | json-ld → — | 2 → 0 | `json-ld @graph[2].sku` | (none) | **yes** | **failed** |

### Credit campaign 2026-10/Campaign 2 2026-10-11/Ruggable

Verification `72f58487-1a6b-4177-97ed-e75cc694791e`: **not passed** — Price, Rating

| Field | Sources before → after | Paths before → after | First path before | First path after | Changed | Outcome |
|---|---|---|---|---|---|---|
| SKU | api → api+json-ld | 2 → 3 | `api [0].vendorCode` | `api [0].vendorCode @ https://www.roomvo.com/services/product/product_mappings/` | no | passed |
| Description | json-ld → json-ld+xpath | 5 → 4 | `json-ld description` | `json-ld description` | no | passed |

### Credit campaign 2026-10/Credit campaign 2026-10/Lookfantastic

Verification `6456db4b-e9d8-4991-8e47-57614d7e453e`: **not passed** — Price, Rating

| Field | Sources before → after | Paths before → after | First path before | First path after | Changed | Outcome |
|---|---|---|---|---|---|---|
| SKU | api → api+json-ld | 4 → 5 | `api response.Results[0].ProductId` | `api itemsData[0].sku @ https://st-eu.dynamicyield.com/spa/json` | **yes** | passed |
| Brand | api → api | 2 → 2 | `api feedProperties.brand` | `api feedProperties.brand @ https://st-eu.dynamicyield.com/spa/json` | no | passed |
| In stock | api → api | 2 → 2 | `api itemsData[0].in_stock` | `api itemsData[0].in_stock @ https://st-eu.dynamicyield.com/spa/json` | no | passed |

### Credit campaign 2026-10/Campaign 2 2026-10-11/Skims

Verification `ec471ede-91b6-4f3c-9281-ec074281695c`: **not passed** — Description

| Field | Sources before → after | Paths before → after | First path before | First path after | Changed | Outcome |
|---|---|---|---|---|---|---|
| Price | json-ld → json-ld+xpath | 5 → 4 | `json-ld hasVariant[0].offers.price` | `json-ld hasVariant[0].offers.price` | no | passed |
| Main image | json-ld → json-ld+meta | 5 → 4 | `json-ld image[0]` | `json-ld image[0]` | no | passed |
| In stock | json-ld → json-ld | 5 → 2 | `json-ld hasVariant[1].offers.availability` | `json-ld hasVariant[1].offers.availability` | no | passed |

### Credit campaign 2026-10/Credit campaign 2026-10/Everlane

Verification `ebea036f-a4f8-486f-a989-bf5054adbf58`: **not passed** — Price, In stock

| Field | Sources before → after | Paths before → after | First path before | First path after | Changed | Outcome |
|---|---|---|---|---|---|---|
| Price | json-ld → — | 5 → 0 | `json-ld hasVariant[0].offers.price` | (none) | **yes** | **failed** |
| Main image | json-ld → json-ld+meta+xpath | 5 → 5 | `json-ld hasVariant[0].image` | `json-ld hasVariant[0].image` | no | passed |

### Credit campaign 2026-10/Campaign 2 2026-10-11/Mejuri

Verification `4db28718-a6ae-4b09-bc7c-4f8e4661d71f`: **not passed** — Price

| Field | Sources before → after | Paths before → after | First path before | First path after | Changed | Outcome |
|---|---|---|---|---|---|---|
| Title | json-ld → json-ld+xpath | 5 → 4 | `json-ld isVariantOf.name` | `json-ld isVariantOf.name` | no | passed |
| Price | json-ld → — | 5 → 0 | `json-ld offers.price` | (none) | **yes** | **failed** |
| Main image | json-ld → json-ld+meta | 5 → 3 | `json-ld image` | `json-ld image` | no | passed |
| SKU | json-ld → json-ld | 2 → 2 | `json-ld sku` | `json-ld sku` | no | passed |
| Brand | json-ld → json-ld+meta | 5 → 3 | `json-ld brand.name` | `json-ld brand.name` | no | passed |
| In stock | json-ld → json-ld | 5 → 2 | `json-ld offers.availability` | `json-ld hasVariant[2].offers.availability` | **yes** | passed |

### Credit campaign 2026-10/Campaign 2 2026-10-11/Sigmabeauty

Verification `31b63e31-8631-471e-91cc-4dfef15de46f`: **passed**

| Field | Sources before → after | Paths before → after | First path before | First path after | Changed | Outcome |
|---|---|---|---|---|---|---|
| SKU | json-ld → json-ld | 2 → 2 | `json-ld sku` | `json-ld sku` | no | passed |

### Credit campaign 2026-10/Campaign 2 2026-10-11/Gymshark

Verification `1a220142-7e0b-4a00-87a4-5a027f7af4fd`: **not passed** — Rating

| Field | Sources before → after | Paths before → after | First path before | First path after | Changed | Outcome |
|---|---|---|---|---|---|---|
| Title | json-ld → json-ld+api+xpath | 5 → 5 | `json-ld name` | `json-ld name` | no | passed |
| Main image | json-ld → json-ld+api+meta | 5 → 5 | `json-ld image[0]` | `json-ld image[0]` | no | passed |

### Credit campaign 2026-10/Campaign 2 2026-10-11/Colourpop

Verification `e207e4d0-04a1-4ca8-bbe6-2c8337c2b611`: **passed**

| Field | Sources before → after | Paths before → after | First path before | First path after | Changed | Outcome |
|---|---|---|---|---|---|---|
| Title | json-ld → json-ld | 5 → 1 | `json-ld name` | `json-ld name` | no | passed |

### Credit campaign 2026-10/Campaign 2 2026-10-11/Ridge

Verification `dc038f49-cd34-48fa-810a-2570dbd363f8`: **not passed** — In stock

| Field | Sources before → after | Paths before → after | First path before | First path after | Changed | Outcome |
|---|---|---|---|---|---|---|
| Brand | api → api+meta | 5 → 3 | `api products[0].vendor` | `api products[0].vendor @ https://ridge.com/collections/kintsugi-eligible-playing-cards-hide/products.json` | no | passed |

### Credit campaign 2026-10/Campaign 2 2026-10-11/Oliverbonas

Verification `be178496-6038-4604-aecf-4906ffbb3cb4`: **not passed** — Rating

| Field | Sources before → after | Paths before → after | First path before | First path after | Changed | Outcome |
|---|---|---|---|---|---|---|
| Main image | json-ld → json-ld+meta | 5 → 4 | `json-ld image[0]` | `json-ld image[0]` | no | passed |

### Credit campaign 2026-10/Campaign 2 2026-10-11/Ikea

Verification `997daff2-75ed-4bc1-b0e3-c6769a01a1e3`: **passed**

| Field | Sources before → after | Paths before → after | First path before | First path after | Changed | Outcome |
|---|---|---|---|---|---|---|
| Price | api → api | 5 → 2 | `api price` | `api price @ https://www.ikea.com/my/en/products/009/10489009.json` | no | passed |

### Credit campaign 2026-10/Campaign 2 2026-10-11/Burrow

Verification `a883cc30-ae25-4860-9238-8aec2e988fed`: **not passed** — Price, Rating

| Field | Sources before → after | Paths before → after | First path before | First path after | Changed | Outcome |
|---|---|---|---|---|---|---|
| Brand | json-ld → json-ld | 5 → 2 | `json-ld brand.name` | `json-ld brand.name` | no | passed |
| In stock | json-ld → json-ld | 5 → 2 | `json-ld hasVariant[0].offers.availability` | `json-ld hasVariant[0].offers.availability` | no | passed |
| Description | json-ld → json-ld+meta | 5 → 3 | `json-ld description` | `json-ld description` | no | passed |

### Credit campaign 2026-10/Campaign 2 2026-10-11/Skullcandy

Verification `ce5c1657-2993-4d8b-b690-2917392db0ce`: **not passed** — Title, Price, Main image, SKU, Brand, In stock, Rating, Description

| Field | Sources before → after | Paths before → after | First path before | First path after | Changed | Outcome |
|---|---|---|---|---|---|---|
| Description | json-ld → — | 2 → 0 | `json-ld description` | (none) | **yes** | **failed** |
