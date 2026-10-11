# Campaign 2 candidates (draft, 2026-10-11) — new waters

The first campaign (2026-10-08) took 16 websites mostly from one shape: large US/UK retailers,
many behind Cloudflare or Akamai. Of 28 further candidates, 2 were open. This list deliberately
goes elsewhere: shops on the platforms most small and mid-size retailers use (Shopify,
BigCommerce, WooCommerce, Magento, Shopware, Salesforce Commerce), in more countries, with
different page data shapes. Every one is a guess until the pre-screen runs; "open" here is an
expectation, not a result.

**Pre-screen (free):** one `sources.checkListingPage` per listing through the app's stealth
browser (never plain headless), after `pnpm dev:all`; record the verdict, the product-link
count and the pager. Walls go into the table as walls and are not retried. Then Verify (free on
every open site so far), the coverage check, Sample, Extract at the smallest budget, and a judge
run per extracted site (paid, ~$0.0086 per value, cap $5 per run, one at a time).

| # | Website | Platform / country | Listing to try | Why |
|---|---|---|---|---|
| 1 | gymshark.com | Shopify Plus, UK | /collections/mens-t-shirts | big Shopify store, variants (size/colour) |
| 2 | bombas.com | Shopify Plus, US | /collections/mens-socks | Shopify with bundles and sizes |
| 3 | brooklinen.com | Shopify Plus, US | /collections/sheets | variants by size and colour |
| 4 | glossier.com | Shopify Plus, US | /collections/skincare | beauty, shade variants |
| 5 | colourpop.com | Shopify, US | /collections/lip | many shades per product |
| 6 | skims.com | Shopify Plus, US | /collections/bras | large catalogue, variants |
| 7 | mejuri.com | Shopify Plus, CA | /collections/rings | jewellery, metal and size variants |
| 8 | ridge.com | Shopify Plus, US | /collections/wallets | few products, many colourways |
| 9 | ruggable.com | Shopify Plus, US | /collections/rugs | size variants, rating widgets |
| 10 | kith.com | Shopify Plus, US | /collections/mens-tops | fashion, sold-out states |
| 11 | skullcandy.com | BigCommerce, US | /headphones | BigCommerce page data |
| 12 | solostove.com | BigCommerce, US | /fire-pits | bundles, ratings |
| 13 | burrow.com | BigCommerce, US | /collections/sofas | configurable furniture |
| 14 | hellyhansen.com | Magento, NO | /en_gb/men/jackets | Magento, EU, sizes |
| 15 | oliverbonas.com | Magento, UK | /womens/clothing | UK mid-size, Magento |
| 16 | sigmabeauty.com | Magento, US | /brushes | beauty, Magento |
| 17 | lacoste.com | Salesforce Commerce, FR | /en-gb/men/clothing/polos | SFCC page data |
| 18 | puma.com | Salesforce Commerce, DE | /uk/en/men/shoes | SFCC, likely Akamai |
| 19 | levi.com | Salesforce Commerce, US | /gb/en_gb/men/clothing/jeans | SFCC |
| 20 | coolblue.nl | custom, NL | /en/laptops | Dutch electronics, open to bots historically |
| 21 | fnac.com | custom, FR | /Casque-audio/… | French media/electronics, Datadome likely |
| 22 | manomano.fr | custom, FR | /perceuse | DIY marketplace |
| 23 | leroymerlin.fr | custom, FR | /… /perceuses | DIY, large catalogue |
| 24 | argos.co.uk | custom, UK | /browse/technology/headphones | Akamai likely |
| 25 | johnlewis.com | custom, UK | /browse/electricals/headphones | UK department store |
| 26 | next.co.uk | custom, UK | /shop/gender-men-productaffiliation-tshirts | UK fashion |
| 27 | zara.com | custom, ES | /uk/en/man-tshirts | SPA, page data via API |
| 28 | hm.com | custom, SE | /en_gb/men/products/t-shirts-tank-tops.html | SPA, www2 redirect (tests the registrable-domain rule) |
| 29 | uniqlo.com | custom, JP/UK | /uk/en/men/tops/t-shirts | SPA, API-driven |
| 30 | thomann.de | custom, DE | /gb/electric_guitars.html | open, deep catalogue, ratings |
| 31 | musicstore.de | custom, DE | /en_GB/EUR/Guitars-Basses/… | music retail |
| 32 | shop.mango.com | custom, ES | /gb/men/t-shirts | fashion SPA |
| 33 | cos.com (re-try) | custom, SE | /en_gbp/men/t-shirts | walled last time; stealth retry |
| 34 | notonthehighstreet.com | custom marketplace, UK | /gifts | marketplace of small sellers |
| 35 | etsy.com (re-try) | marketplace, US | /uk/c/jewelry | walled last time; one stealth retry |
| 36 | ikea.com (control) | custom, SE | the verified website | control: everything should still pass |

**What to record per website** (the first campaign's table columns): reachability, products
found, proof pages, agreed/marked/typed/absent counts, Verify cost shown and spent, coverage
check result (empties per field and the explanation), Sample, Extract rows and fill per field,
judge correctness per field, defects found. New this time: whether the coverage check named the
right pages before the run, and whether "Not on this product" was needed.

**Budget:** judge runs only. A 60-item run with 8 fields ≈ $4; ten extracted sites ≈ $40 to $50.
Marko's direction (2026-10-11): spend it.
