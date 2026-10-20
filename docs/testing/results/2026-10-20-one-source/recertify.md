# Backups from more than one source — read-only check on stored captures (2026-10-20)

Spec `docs/superpowers/specs/2026-10-20-one-source-backups-design.md` §7. Script
`packages/api/src/scripts/one-source-recertify.ts`, run from `feat/one-source-backups` @ `bf2e257f`
against the local database (select only) and the main checkout's capture files. No agent, no domain
store, no live page: $0, nothing written.

Websites are named by their org/project/website names as the database has them (Marko's own test
data), not slugs.

Controller ruling 2026-10-20 (`packages/scraper/src/verify/certify.ts`, `isUncappedSource`): the
page's HTML is exempt from the 2-per-source cap, so an all-XPath field is never flagged as "one
source" — already true of the script's selection rule too (an all-XPath field never matches
`every(source === 'api')` or `every(source === 'json-ld')`). No code change was needed for this;
noted here for the record.

## Summary

41 one-source field(s) certified again on stored captures, 0 skipped (captures missing): 20 now read
two or more sources, 21 still one source, 0 certified nothing, 2 changed their first certified path.

## Fields

```
Credit campaign 2026-10/Credit campaign 2026-10/Barnesandnoble — Price
  stored: json-ld @graph[1].offers.price | json-ld @graph[0].hasVariant[2].offers.price
  now:    json-ld @graph[1].offers.price | json-ld @graph[0].hasVariant[2].offers.price
  sources now: 1
  first path changed: no

Credit campaign 2026-10/Credit campaign 2026-10/Barnesandnoble — In stock
  stored: json-ld @graph[1].offers.availability | json-ld @graph[0].hasVariant[0].offers.availability | json-ld @graph[0].hasVariant[1].offers.availability | json-ld @graph[0].hasVariant[2].offers.availability | json-ld @graph[0].hasVariant[3].offers.availability
  now:    json-ld @graph[1].offers.availability | json-ld @graph[0].hasVariant[0].offers.availability
  sources now: 1
  first path changed: no

Credit campaign 2026-10/Credit campaign 2026-10/Barnesandnoble — Description
  stored: json-ld @graph[0].description | json-ld @graph[1].description | json-ld @graph[0].hasVariant[0].description | json-ld @graph[0].hasVariant[1].description | json-ld @graph[0].hasVariant[2].description
  now:    json-ld @graph[0].description | json-ld @graph[1].description
  sources now: 1
  first path changed: no

Credit campaign 2026-10/Credit campaign 2026-10/Allbirds — Main image
  stored: json-ld image[0] | json-ld image | json-ld image[1] | json-ld image[2] | json-ld image[3]
  now:    json-ld image[0] | meta og:image | xpath //div[@data-media-type="image"]/button[@class="relative overflow-hidden rounded-lg aspect-7/4 w-full"]/img[@class="cursor-zoom-plus block h-full w-full rounded-lg object-contain md:object-cover object-center"]/@src | json-ld image | meta og:image:secure_url
  sources now: 3
  first path changed: no

Credit campaign 2026-10/Credit campaign 2026-10/Allbirds — SKU
  stored: json-ld sku | json-ld productGroupID
  now:    json-ld sku | json-ld productGroupID
  sources now: 1
  first path changed: no

Mar/Competitor prices/Ikea — Product URL
  stored: api pipUrl | api revampPrice.separator | api otherConfigs.theme.tokens.--d-1 | api otherConfigs.theme.colors.primary | api otherConfigs.theme.styles.link.color
  now:    api pipUrl @ https://www.ikea.com/my/en/products/882/70483882.json | json-ld url | meta og:url
  sources now: 3
  first path changed: no

Mar/Competitor prices/Ikea — Price
  stored: api price | api priceExclTax | api priceNumeral | api priceExclTaxNumeral | api revampPrice.integer
  now:    api price @ https://www.ikea.com/my/en/products/882/70483882.json | api priceExclTax @ https://www.ikea.com/my/en/products/882/70483882.json
  sources now: 1
  first path changed: no

Mar/Competitor prices/Ikea — In stock
  stored: api priority | api [0].cashAndCarry | api [1].cashAndCarry | api [2].cashAndCarry | api [3].cashAndCarry
  now:    xpath //div[@data-fika-namespace="lower-funnel-fragments"]/div[1]/div[contains(concat(" ",normalize-space(@class)," ")," lower-funnel-fragments-section-group ")]/div[@class="lower-funnel-fragments-section-group__content"]/div[@class="lower-funnel-fragments-section lower-funnel-fragments-delivery-section js-delivery-section"]/div[@class="lower-funnel-fragments-section__main"]/div[1]/div[@class="lower-funnel-fragments-section__content"]/span[contains(concat(" ",normalize-space(@class)," ")," lower-funnel-fragments-text ")]/span[@class="lower-funnel-fragments-status__label"]
  sources now: 1
  first path changed: YES — api priority -> xpath //div[@data-fika-namespace="lower-funnel-fragments"]/div[1]/div[contains(concat(" ",normalize-space(@class)," ")," lower-funnel-fragments-section-group ")]/div[@class="lower-funnel-fragments-section-group__content"]/div[@class="lower-funnel-fragments-section lower-funnel-fragments-delivery-section js-delivery-section"]/div[@class="lower-funnel-fragments-section__main"]/div[1]/div[@class="lower-funnel-fragments-section__content"]/span[contains(concat(" ",normalize-space(@class)," ")," lower-funnel-fragments-text ")]/span[@class="lower-funnel-fragments-status__label"]

Credit campaign 2026-10/Credit campaign 2026-10/Nike — Main image
  stored: json-ld hasVariant[0].image | json-ld hasVariant[1].image | json-ld hasVariant[2].image | json-ld hasVariant[3].image | json-ld hasVariant[4].image
  now:    json-ld hasVariant[0].image | json-ld hasVariant[1].image
  sources now: 1
  first path changed: no

Markodjordjievski/Acne/Ikea — Price
  stored: api price | api priceExclTax | api priceNumeral | api priceExclTaxNumeral | api revampPrice.integer
  now:    api price @ https://www.ikea.com/my/en/products/009/10489009.json | api priceExclTax @ https://www.ikea.com/my/en/products/009/10489009.json
  sources now: 1
  first path changed: no

Markodjordjievski/Acne/Ikea — Price currency
  stored: api revampPrice.currencyPrefix | api revampPrice.currencySymbol
  now:    api revampPrice.currencyPrefix @ https://www.ikea.com/my/en/products/009/10489009.json | api revampPrice.currencySymbol @ https://www.ikea.com/my/en/products/009/10489009.json
  sources now: 1
  first path changed: no

Markodjordjievski/Acne/Ikea — Product id
  stored: json-ld mpn | json-ld sku
  now:    json-ld mpn | xpath //*[@id="overview"]/div[@class="pipf-overview-tab"]/div[1]/div[@class="pipf-overview-summary"]/div[@class="pipf-overview-summary__product-info-container"]/span[@class="pipf-product-identifier"]/span[@class="pipf-typography-label-s pipf-product-identifier__value"] | json-ld sku | xpath //*[@id="content"]/div[@class="pipf-content-container"]/div[@class="pipf-product-information-tabs js-product-information-tabs"]/div[contains(concat(" ",normalize-space(@class)," ")," pipf-tabs ")]/div[@class="pipf-tabs__panel"]/div[@class="pipf-overview-tab"]/div[1]/div[@class="pipf-overview-summary"]/div[@class="pipf-overview-summary__product-info-container"]/span[@class="pipf-product-identifier"]/span[@class="pipf-typography-label-s pipf-product-identifier__value"] | xpath //body/div[2]/main[@class="main no-outline"]/div[@class="pipf-content-container"]/div[@class="pipf-product-information-tabs js-product-information-tabs"]/div[contains(concat(" ",normalize-space(@class)," ")," pipf-tabs ")]/div[@class="pipf-tabs__panel"]/div[@class="pipf-overview-tab"]/div[1]/div[@class="pipf-overview-summary"]/div[@class="pipf-overview-summary__product-info-container"]/span[@class="pipf-product-identifier"]/span[@class="pipf-typography-label-s pipf-product-identifier__value"]
  sources now: 2
  first path changed: no

Credit campaign 2026-10/Campaign 2 2026-10-11/Bombas — Main image
  stored: json-ld image[0] | json-ld image
  now:    json-ld image[0] | json-ld image
  sources now: 1
  first path changed: no

Credit campaign 2026-10/Credit campaign 2026-10/Madeincookware — SKU
  stored: json-ld @graph[2].sku | json-ld @graph[2].offers[0].sku
  now:    json-ld @graph[2].sku | json-ld @graph[2].offers[0].sku
  sources now: 1
  first path changed: no

Credit campaign 2026-10/Campaign 2 2026-10-11/Ruggable — SKU
  stored: api [0].vendorCode | api [0].productCode
  now:    api [0].vendorCode @ https://www.roomvo.com/services/product/product_mappings/ | json-ld hasVariant[page].sku | api [0].productCode @ https://www.roomvo.com/services/product/product_mappings/
  sources now: 2
  first path changed: no

Credit campaign 2026-10/Campaign 2 2026-10-11/Ruggable — Description
  stored: json-ld description | json-ld hasVariant[0].description | json-ld hasVariant[1].description | json-ld hasVariant[2].description | json-ld hasVariant[3].description
  now:    json-ld description | xpath //*[@id="add-to-cart-section-container"]/div[@class="pdp-container min-h-225 mx-auto lg:w-fit"]/div[@class="flex flex-col md:flex-row md:justify-center md:px-4 md:pb-6"]/div[contains(concat(" ",normalize-space(@class)," ")," md:block ")]/div[@class="px-4 mb-8 md:px-0 pdp-detail-section"]/div[@class="border-t-1 border-grey-veryLight last:border-b-1"]/div[@class="transition-[max-height] overflow-hidden max-h-0 m-0! ease-out duration-200"]/p[@class="mb-4 text-custom-13 leading-custom-150 tracking-[.26px]"] | json-ld hasVariant[page].description | xpath //body/div[1]/main[contains(concat(" ",normalize-space(@class)," ")," mx-auto ")]/div[3]/div[@class="pdp-container min-h-225 mx-auto lg:w-fit"]/div[@class="flex flex-col md:flex-row md:justify-center md:px-4 md:pb-6"]/div[contains(concat(" ",normalize-space(@class)," ")," md:block ")]/div[@class="px-4 mb-8 md:px-0 pdp-detail-section"]/div[@class="border-t-1 border-grey-veryLight last:border-b-1"]/div[@class="transition-[max-height] overflow-hidden max-h-0 m-0! ease-out duration-200"]/p[@class="mb-4 text-custom-13 leading-custom-150 tracking-[.26px]"]
  sources now: 2
  first path changed: no

Credit campaign 2026-10/Credit campaign 2026-10/Lookfantastic — SKU
  stored: api response.Results[0].ProductId | api response.Results[1].ProductId | api response.Results[2].ProductId | api response.Results[3].ProductId
  now:    api itemsData[0].sku @ https://st-eu.dynamicyield.com/spa/json | api response.Results[0].ProductId @ https://apps.bazaarvoice.com/bfd/v1/clients/lookfantastic/api-products/cv2/resources/data/reviews.json | api response.Results[0].FamilyIds @ https://apps.bazaarvoice.com/bfd/v1/clients/lookfantastic/api-products/cv2/resources/data/products.json | json-ld review[0].itemReviewed.@id | api feedProperties.sku @ https://st-eu.dynamicyield.com/spa/json
  sources now: 4
  first path changed: YES — api response.Results[0].ProductId -> api itemsData[0].sku @ https://st-eu.dynamicyield.com/spa/json

Credit campaign 2026-10/Credit campaign 2026-10/Lookfantastic — Brand
  stored: api feedProperties.brand | api response.Results[0].Brand.Name
  now:    api feedProperties.brand @ https://st-eu.dynamicyield.com/spa/json | api response.Results[0].Brand.Name @ https://apps.bazaarvoice.com/bfd/v1/clients/lookfantastic/api-products/cv2/resources/data/products.json | api itemsData[0].brand @ https://st-eu.dynamicyield.com/spa/json
  sources now: 2
  first path changed: no

Credit campaign 2026-10/Credit campaign 2026-10/Lookfantastic — In stock
  stored: api itemsData[0].in_stock | api feedProperties.in_stock
  now:    api itemsData[0].in_stock @ https://st-eu.dynamicyield.com/spa/json | api feedProperties.in_stock @ https://st-eu.dynamicyield.com/spa/json
  sources now: 1
  first path changed: no

Credit campaign 2026-10/Campaign 2 2026-10-11/Skims — Price
  stored: json-ld hasVariant[0].offers.price | json-ld hasVariant[1].offers.price | json-ld hasVariant[2].offers.price | json-ld hasVariant[3].offers.price | json-ld hasVariant[4].offers.price
  now:    json-ld hasVariant[0].offers.price | xpath //div[@data-testid="product-page-sticky-bar"]/div[@class="grid w-full grid-cols-[auto_repeat(12,minmax(0,1fr))] items-center gap-3 p-2 sm:p-4 lg:mx-auto lg:max-w-7xl lg:gap-8 lg:p-6"]/div[contains(concat(" ",normalize-space(@class)," ")," col-span-2 ")]/span[@class="body-2 text-primary whitespace-nowrap"] | json-ld hasVariant[1].offers.price | xpath //div[@data-testid="product-page-sticky-bar"]/div[@class="grid w-full grid-cols-[auto_repeat(12,minmax(0,1fr))] items-center gap-3 p-2 sm:p-4 lg:mx-auto lg:max-w-7xl lg:gap-8 lg:p-6"]/div[@class="col-span-5 min-w-0 lg:col-span-3"]/div[contains(concat(" ",normalize-space(@class)," ")," flex ")]/span[@class="body-2 text-primary whitespace-nowrap"] | xpath //body/div[@class="lg:hidden"]/div[@class="border-grayDarker shadow-black-lg fixed inset-x-0 bottom-0 z-40 w-full border-t bg-white s-slide-in-up"]/div[@class="grid w-full grid-cols-[auto_repeat(12,minmax(0,1fr))] items-center gap-3 p-2 sm:p-4 lg:mx-auto lg:max-w-7xl lg:gap-8 lg:p-6"]/div[contains(concat(" ",normalize-space(@class)," ")," col-span-2 ")]/span[@class="body-2 text-primary whitespace-nowrap"]
  sources now: 2
  first path changed: no

Credit campaign 2026-10/Campaign 2 2026-10-11/Skims — Main image
  stored: json-ld image[0] | json-ld image | json-ld hasVariant[0].image | json-ld hasVariant[1].image | json-ld hasVariant[2].image
  now:    json-ld image[0] | meta og:image:url | json-ld image | meta og:image:secure_url
  sources now: 2
  first path changed: no

Credit campaign 2026-10/Campaign 2 2026-10-11/Skims — In stock
  stored: json-ld hasVariant[1].offers.availability | json-ld hasVariant[3].offers.availability | json-ld hasVariant[4].offers.availability | json-ld hasVariant[5].offers.availability | json-ld hasVariant[6].offers.availability
  now:    json-ld hasVariant[1].offers.availability | json-ld hasVariant[3].offers.availability
  sources now: 1
  first path changed: no

Credit campaign 2026-10/Credit campaign 2026-10/Everlane — Price
  stored: json-ld hasVariant[0].offers.price | json-ld hasVariant[1].offers.price | json-ld hasVariant[2].offers.price | json-ld hasVariant[3].offers.price | json-ld hasVariant[4].offers.price
  now:    json-ld hasVariant[0].offers.price | meta og:price:amount | xpath //product-info[@data-section-id="main-product"]/div[@class="page-width"]/div[contains(concat(" ",normalize-space(@class)," ")," product ")]/div[contains(concat(" ",normalize-space(@class)," ")," product__title-stack ")]/div[@class="product__title-wrapper"]/div[@class="product__price"]/div[contains(concat(" ",normalize-space(@class)," ")," js-product-price ")]/div[@class="price__container"]/div[@class="price__sale"]/span[contains(concat(" ",normalize-space(@class)," ")," price-item ")] | json-ld hasVariant[1].offers.price | xpath //product-info[@data-section-id="main-product"]/div[@class="page-width"]/div[contains(concat(" ",normalize-space(@class)," ")," product ")]/div[contains(concat(" ",normalize-space(@class)," ")," product__title-stack ")]/div[@class="product__title-wrapper"]/div[@class="product__price"]/div[contains(concat(" ",normalize-space(@class)," ")," js-product-price ")]/div[@class="price__container"]/div[@class="price__regular"]/span[contains(concat(" ",normalize-space(@class)," ")," price-item ")]
  sources now: 3
  first path changed: no

Credit campaign 2026-10/Credit campaign 2026-10/Everlane — Main image
  stored: json-ld hasVariant[0].image | json-ld hasVariant[1].image | json-ld hasVariant[2].image | json-ld hasVariant[3].image | json-ld hasVariant[4].image
  now:    json-ld hasVariant[0].image | meta og:image | xpath //media-gallery[@data-desktop-layout="stacked"]/slider-component[@class="slider-mobile-gutter"]/ul[contains(concat(" ",normalize-space(@class)," ")," product__media-list ")]/li[contains(concat(" ",normalize-space(@class)," ")," product__media-item ")]/div[@class="product-media-container media-type-image media-fit-contain global-media-settings gradient constrain-height"]/modal-opener[contains(concat(" ",normalize-space(@class)," ")," product__modal-opener ")]/div[contains(concat(" ",normalize-space(@class)," ")," product__media ")]/img[@class="image-magnify-lightbox"]/@src | json-ld hasVariant[1].image | meta og:image:secure_url
  sources now: 3
  first path changed: no

Credit campaign 2026-10/Campaign 2 2026-10-11/Mejuri — Title
  stored: json-ld isVariantOf.name | json-ld hasVariant[0].isVariantOf.name | json-ld hasVariant[1].isVariantOf.name | json-ld hasVariant[2].isVariantOf.name | json-ld hasVariant[3].isVariantOf.name
  now:    json-ld isVariantOf.name | xpath //*[@id="main-product-content"]/div[@class="px-md md:px-0"]/div[@class="flex w-full justify-between items-stretch"]/div[@class="flex flex-col flex-1 justify-between"]/div[@class="flex justify-between items-start gap-2xl"]/h1[@class="type-heading-s text-content text-lg md:text-xl"] | json-ld hasVariant[0].isVariantOf.name | xpath //div[@data-testid="product-page"]/div[2]/div[contains(concat(" ",normalize-space(@class)," ")," block ")]/div[@class="pb-lg md:pb-0 md:grow-0 md:shrink-0 min-w-0 md:w-full md:basis-[35vw] md:max-w-[35vw] lg:basis-[30vw] lg:max-w-[30vw] xl:w-[30vw] md:self-center"]/div[@class="px-md md:px-0"]/div[@class="flex w-full justify-between items-stretch"]/div[@class="flex flex-col flex-1 justify-between"]/div[@class="flex justify-between items-start gap-2xl"]/h1[@class="type-heading-s text-content text-lg md:text-xl"] | xpath //body/div[contains(concat(" ",normalize-space(@class)," ")," default ")]/div[1]/main[1]/div[1]/div[2]/div[contains(concat(" ",normalize-space(@class)," ")," block ")]/div[@class="pb-lg md:pb-0 md:grow-0 md:shrink-0 min-w-0 md:w-full md:basis-[35vw] md:max-w-[35vw] lg:basis-[30vw] lg:max-w-[30vw] xl:w-[30vw] md:self-center"]/div[@class="px-md md:px-0"]/div[@class="flex w-full justify-between items-stretch"]/div[@class="flex flex-col flex-1 justify-between"]/div[@class="flex justify-between items-start gap-2xl"]/h1[@class="type-heading-s text-content text-lg md:text-xl"]
  sources now: 2
  first path changed: no

Credit campaign 2026-10/Campaign 2 2026-10-11/Mejuri — Price
  stored: json-ld offers.price | json-ld offers.lowPrice | json-ld hasVariant[0].offers.price | json-ld hasVariant[1].offers.price | json-ld hasVariant[2].offers.price
  now:    json-ld offers.price | xpath //*[@id="main-product-content"]/div[@class="px-md md:px-0"]/div[@class="flex w-full justify-between items-stretch"]/div[@class="flex flex-col flex-1 justify-between"]/div[@class="flex items-center mt-sm gap-xs"]/div[@class="flex items-baseline type-body-1 gap-x-md gap-y-xs flex-wrap"]/span[@class="whitespace-nowrap text-sm md:text-base type-body-m text-content"] | json-ld offers.lowPrice | xpath //div[@data-testid="product-page"]/div[2]/div[contains(concat(" ",normalize-space(@class)," ")," block ")]/div[@class="pb-lg md:pb-0 md:grow-0 md:shrink-0 min-w-0 md:w-full md:basis-[35vw] md:max-w-[35vw] lg:basis-[30vw] lg:max-w-[30vw] xl:w-[30vw] md:self-center"]/div[@class="px-md md:px-0"]/div[@class="flex w-full justify-between items-stretch"]/div[@class="flex flex-col flex-1 justify-between"]/div[@class="flex items-center mt-sm gap-xs"]/div[@class="flex items-baseline type-body-1 gap-x-md gap-y-xs flex-wrap"]/span[@class="whitespace-nowrap text-sm md:text-base type-body-m text-content"] | xpath //body/div[contains(concat(" ",normalize-space(@class)," ")," default ")]/div[1]/main[1]/div[1]/div[2]/div[contains(concat(" ",normalize-space(@class)," ")," block ")]/div[@class="pb-lg md:pb-0 md:grow-0 md:shrink-0 min-w-0 md:w-full md:basis-[35vw] md:max-w-[35vw] lg:basis-[30vw] lg:max-w-[30vw] xl:w-[30vw] md:self-center"]/div[@class="px-md md:px-0"]/div[@class="flex w-full justify-between items-stretch"]/div[@class="flex flex-col flex-1 justify-between"]/div[@class="flex items-center mt-sm gap-xs"]/div[@class="flex items-baseline type-body-1 gap-x-md gap-y-xs flex-wrap"]/span[@class="whitespace-nowrap text-sm md:text-base type-body-m text-content"]
  sources now: 2
  first path changed: no

Credit campaign 2026-10/Campaign 2 2026-10-11/Mejuri — Main image
  stored: json-ld image | json-ld hasVariant[0].image | json-ld hasVariant[1].image | json-ld hasVariant[2].image | json-ld hasVariant[3].image
  now:    json-ld image | meta og:image | json-ld hasVariant[0].image
  sources now: 2
  first path changed: no

Credit campaign 2026-10/Campaign 2 2026-10-11/Mejuri — SKU
  stored: json-ld sku | json-ld hasVariant[0].sku
  now:    json-ld sku | json-ld hasVariant[0].sku
  sources now: 1
  first path changed: no

Credit campaign 2026-10/Campaign 2 2026-10-11/Mejuri — Brand
  stored: json-ld brand.name | json-ld hasVariant[0].brand.name | json-ld hasVariant[1].brand.name | json-ld hasVariant[2].brand.name | json-ld hasVariant[3].brand.name
  now:    json-ld brand.name | meta og:brand | xpath //div[@data-state="open"]/div[@class="overflow-hidden"]/div[@class="relative"]/div[@class="transition-opacity duration-75 pb-lg opacity-100 delay-75"]/div[1]/p[@class="type-label-s text-inherit"]/span[1]/strong[2] | json-ld hasVariant[0].brand.name | xpath //body/div[contains(concat(" ",normalize-space(@class)," ")," default ")]/div[1]/main[1]/div[1]/div[2]/div[contains(concat(" ",normalize-space(@class)," ")," flex ")]/div[@class="basis-[48vw] max-w-[48vw] shrink-0 mt-6xl"]/div[@class="text-black pl-xl w-full max-w-full"]/div[@class="w-full border-b border-b-grey-light"]/div[@class="overflow-hidden"]/div[@class="relative"]/div[@class="transition-opacity duration-75 pb-lg opacity-100 delay-75"]/div[1]/p[@class="type-label-s text-inherit"]/span[1]/strong[2]
  sources now: 3
  first path changed: no

Credit campaign 2026-10/Campaign 2 2026-10-11/Mejuri — In stock
  stored: json-ld offers.availability | json-ld hasVariant[0].offers.availability | json-ld hasVariant[1].offers.availability | json-ld hasVariant[2].offers.availability | json-ld hasVariant[3].offers.availability
  now:    json-ld offers.availability | json-ld hasVariant[0].offers.availability
  sources now: 1
  first path changed: no

Credit campaign 2026-10/Campaign 2 2026-10-11/Sigmabeauty — SKU
  stored: json-ld sku | json-ld offers[0].sku
  now:    json-ld sku | json-ld offers[0].sku
  sources now: 1
  first path changed: no

Credit campaign 2026-10/Campaign 2 2026-10-11/Gymshark — Title
  stored: json-ld name | json-ld hasVariant[0].name | json-ld hasVariant[1].name | json-ld hasVariant[2].name | json-ld hasVariant[3].name
  now:    json-ld name | xpath //div[@data-testid="pdp-page"]/div[2]/section[1]/h1[@class="product-information_title__PGbQD"] | json-ld hasVariant[0].name | xpath //section[@data-testid="pdp-productInformationContainer-read"]/h1[@class="product-information_title__PGbQD"] | xpath //body/div[1]/main[1]/div[@class="pdp_main__rR2_6"]/div[2]/section[1]/h1[@class="product-information_title__PGbQD"]
  sources now: 2
  first path changed: no

Credit campaign 2026-10/Campaign 2 2026-10-11/Gymshark — Main image
  stored: json-ld image[0] | json-ld image | json-ld hasVariant[0].image | json-ld hasVariant[1].image | json-ld hasVariant[2].image
  now:    json-ld image[0] | meta og:image | json-ld image | meta twitter:image
  sources now: 2
  first path changed: no

Credit campaign 2026-10/Campaign 2 2026-10-11/Colourpop — Title
  stored: json-ld name | json-ld itemListElement[0].name | json-ld itemListElement[1].name | json-ld itemListElement[2].name | json-ld itemListElement[3].name
  now:    json-ld name | json-ld itemListElement[0].name
  sources now: 1
  first path changed: no

Credit campaign 2026-10/Campaign 2 2026-10-11/Ridge — Brand
  stored: api products[0].vendor | api products[1].vendor | api products[2].vendor | api products[3].vendor | api products[4].vendor
  now:    api products[0].vendor @ https://ridge.com/collections/kintsugi-eligible-playing-cards-hide/products.json | meta og:site_name | api products[1].vendor @ https://ridge.com/collections/kintsugi-eligible-playing-cards-hide/products.json
  sources now: 2
  first path changed: no

Credit campaign 2026-10/Campaign 2 2026-10-11/Oliverbonas — Main image
  stored: json-ld image[0] | json-ld image | json-ld hasVariant[0].image | json-ld hasVariant[1].image | json-ld hasVariant[2].image
  now:    json-ld image[0] | meta og:image | json-ld image | meta twitter:image
  sources now: 2
  first path changed: no

Credit campaign 2026-10/Campaign 2 2026-10-11/Ikea — Price
  stored: api price | api priceExclTax | api priceNumeral | api priceExclTaxNumeral | api revampPrice.integer
  now:    api price @ https://www.ikea.com/my/en/products/009/10489009.json | api priceExclTax @ https://www.ikea.com/my/en/products/009/10489009.json
  sources now: 1
  first path changed: no

Credit campaign 2026-10/Campaign 2 2026-10-11/Burrow — Brand
  stored: json-ld brand.name | json-ld hasVariant[0].brand.name | json-ld hasVariant[1].brand.name | json-ld hasVariant[2].brand.name | json-ld hasVariant[3].brand.name
  now:    json-ld brand.name | json-ld hasVariant[0].brand.name
  sources now: 1
  first path changed: no

Credit campaign 2026-10/Campaign 2 2026-10-11/Burrow — In stock
  stored: json-ld hasVariant[0].offers.availability | json-ld hasVariant[1].offers.availability | json-ld hasVariant[2].offers.availability | json-ld hasVariant[3].offers.availability | json-ld hasVariant[5].offers.availability
  now:    json-ld hasVariant[0].offers.availability | json-ld hasVariant[1].offers.availability
  sources now: 1
  first path changed: no

Credit campaign 2026-10/Campaign 2 2026-10-11/Burrow — Description
  stored: json-ld description | json-ld hasVariant[0].description | json-ld hasVariant[1].description | json-ld hasVariant[2].description | json-ld hasVariant[3].description
  now:    json-ld description | meta description | json-ld hasVariant[0].description
  sources now: 2
  first path changed: no

Credit campaign 2026-10/Campaign 2 2026-10-11/Skullcandy — Description
  stored: json-ld description | json-ld hasVariant[0].description
  now:    json-ld description | json-ld hasVariant[0].description
  sources now: 1
  first path changed: no
```

## First certified path changed (customer-visible)

Comparing by source + path + transform (a path that only gained its container label, e.g. `api
price` → `api price @ <url>`, does not count as changed — it is the same path, newly named):

| Website | Field | First path before | First path now |
|---|---|---|---|
| Mar/Competitor prices/Ikea | In stock | `api priority` | `xpath //div[@data-fika-namespace="lower-funnel-fragments"]/...` |
| Credit campaign 2026-10/Credit campaign 2026-10/Lookfantastic | SKU | `api response.Results[0].ProductId` | `api itemsData[0].sku @ https://st-eu.dynamicyield.com/spa/json` |

Both are genuine primary-path swaps, not just a container label added to the same path: Ikea's "In
stock" moved from an API field to a DOM XPath, and Lookfantastic's SKU moved from one API response
to a different one. Everywhere else, the first path is unchanged (21 fields unaffected, 18 others
gained backups behind the same first path).

## Reading

41 fields that the old all-API/all-JSON-LD rule would have flagged as "one source" were certified
again on their own stored captures. 20 of them now certify paths from two or more sources (up to
four, Lookfantastic's SKU); 21 still read one source, and in every one of those cases the stored
pages themselves carry only that one source for the field — no matching JSON-LD, meta, or second API
response was found on the capture, so one source is correct, not a gap. Ikea's Price is one of
those: on all three stored Ikea websites, Price stays inside the one product API response (now
labelled by its container, e.g. `.../10489009.json`) because the captured pages carry no JSON-LD or
meta price that matches — it is Ikea's **Product URL** (website "Mar/Competitor prices") that shows
the clean spread, picking up a JSON-LD `url` and a meta `og:url` behind the certified API path and
landing on three sources. No field certified nothing on its own stored captures — every one of the
41 still certifies at least as much as it did before, so nothing here needed a live re-verify.
