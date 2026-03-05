/* eslint-disable no-param-reassign */
/**
 *
 * @param {ImportIO.Group[]} data
 * @returns {ImportIO.Group[]}
 */
const cleanUp = (data) => {
  const mapping = {
    product_url: (text, row) => {
      const productUrl = row.product_url?.[0]?.text;
      if (productUrl?.includes('A-')) {
        const id = productUrl?.split('A-')?.[1];
        row.product_mpn = [{ text: id }];
        row.product_sku = [{ text: id }];
        return productUrl;
      }
      const tcin = row.GTIN?.[0]?.text?.split(':')[1]?.trim();
      row.product_mpn = [{ text: tcin }];
      row.product_sku = [{ text: tcin }];
      return `https://www.target.com/p/-/A-${tcin}`;
    },
    product_hierarchy_transform: (text, row) => {
      const productHierarchy = row.product_hierarchy;
      if (productHierarchy) {
        productHierarchy.shift();
      }
      row.product_hierarchy = productHierarchy;
    },
    collected_product_features: (text, row) => {
      row.product_features = row.product_features?.reduce((result, feature) => {
        const [name, value] = feature.text.split(':').map(part => part?.trim());
        return [...result, { text: JSON.stringify({ name, value }) }];
      }, []);
    },
    UPC: (text, row) => {
      row.product_barcodes = ['UPC', 'GTIN', 'EAN', 'DCIN'].reduce((acc, key) => [...acc, { text: JSON.stringify({ name: key, value: row[key]?.[0]?.text?.split(':')[1]?.trim() || null }) }], []);
    },
    product_brand: text => text.replace(/(.*)Shop all (.*)/g, '$2'),
    product_model_number: (text, row) => {
      const productName = row.product_name?.[0]?.text;

      if (productName.includes('|')) {
        const splitProductName = text.split('|');
        return splitProductName[1]?.trim();
      }
      return null;
    },
    product_grocery_attributes: (text, row) => {
      const allergens = row.allergens?.[0]?.text.split(':')[1]?.trim();
      const calories = row.calories?.[0]?.text;
      const disclaimer = row.disclaimer?.[0]?.text;
      const ingredients = row.ingredients?.[0]?.text.trim();
      const servingSize = row.serving_size?.[0]?.text.split(':')[1]?.trim();

      return JSON.stringify({
        allergens,
        calories,
        disclaimer,
        ingredients,
        servingSize,
      });
    },
    product_offers: (text, row) => {
      const sellerPrice = row.product_price?.[0]?.text;
      let sellerName = row.seller_name?.[0]?.text;
      let sellerId = row.seller_id?.[0]?.text;
      const availability = row.product_purchasable?.[0]?.text;

      let fulfilledByTarget = false;
      if (!sellerName) {
        sellerName = 'Target';
        sellerId = null;
        fulfilledByTarget = true;
      }

      return JSON.stringify({
        seller_name: sellerName,
        seller_id: sellerId,
        price: sellerPrice,
        buybox_winner: null,
        fulfilled_by_target: fulfilledByTarget,
        availability,
      });
    },
    product_images_variations: (text, row) => {
      // choose the right place to take product_images from
      const productImagesVariations = JSON.parse(row.product_images_variations?.[0]?.text);

      if (productImagesVariations) {
        const productImages = [];
        const productImagesHQ = [];

        // variation processing by id
        productImagesVariations.forEach((variation) => {
          /*
          TODO:
          This row.GTIN?.text?.split(':')[1]?.trim() isn't a good approach and might be good to be modified
          The problem is the barcode components UPC, GTIN, DCIN are extracted like ": number".
          The extra ": " should be removed from the extraction, maybe using a regex, so that will solve it.
          */
          if (variation.tcin.trim() === row.GTIN[0].text?.split(':')[1]?.trim()) {
            // extract images from enrichment into productImages
            productImages.push({ text: variation?.item?.enrichment?.images?.primary_image_url });
            productImagesHQ.push({ text: `${variation?.item?.enrichment?.images?.primary_image_url}?wid=2000` });
            Object.values(variation?.item?.enrichment?.images?.alternate_image_urls).forEach((url) => {
              productImages.push({ text: url });
              productImagesHQ.push({ text: `${url}?wid=2000` });
            });
          }
        });

        row.product_images = productImages;
        row.product_images_high_quality = productImagesHQ;
      }
    },
  };

  const mappingFct = (header, arr, row) => arr.map(({ text, ...other }) => ({ text: mapping[header](text, row), ...other }));

  data.forEach(obj => obj.group.forEach(row => Object.keys(row).forEach((header) => {
    // eslint-disable-next-line no-param-reassign
    if (mapping[header]) row[header] = mappingFct(header, row[header], row);
  })));

  return data;
};

module.exports = { cleanUp };
