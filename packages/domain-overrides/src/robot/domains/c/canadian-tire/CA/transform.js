/* eslint-disable no-param-reassign */
/**
 *
 * @param {ImportIO.Group[]} data
 * @returns {ImportIO.Group[]}
 */
//
const cleanUp = (data) => {
  const getApplicationJsonData = row => JSON.parse(row.application_json_data?.[0]?.text || '{}');

  const getSpecs = (text, row) => {
    const appJsonData = getApplicationJsonData(row);
    const productSKU = appJsonData.sku;

    const json = JSON.parse(text);
    const specs = json.specifications;
    const skuSpecs = json.skus?.find(
      skuData => skuData.code === productSKU,
    )?.specifications;
    return skuSpecs || specs || [];
  };

  const getDigitOnly = (text) => {
    const onlyDecimalDigitsRegex = /(\d+,?\.?\d*)/;
    const match = text?.match(onlyDecimalDigitsRegex);
    return match?.[1].replace(',', '.') || null;
  };

  const getDimensions = (dimension, specs) => specs.find(spec => spec.code.toLowerCase().includes(dimension))
    ?.value;

  const mapping = {
    colour: (text, row) => getSpecs(text, row)
      .filter(spec => spec.code?.toLowerCase().includes('colour'))
      .map(spec => spec?.value)
      .join(', '),
    product_dimensions: (text, row) => {
      const specs = getSpecs(text, row);

      const assembledHeight = getDimensions('assembled_height_cm', specs);
      const assembledLength = getDimensions('assembled_length_cm', specs);
      const assembledWidth = getDimensions('assembled_width_cm', specs);
      const assembledDepth = getDimensions('assembled_depth_cm', specs);

      const productHeight = getDimensions('product_height_cm', specs);
      const productLength = getDimensions('product_length_cm', specs);
      const productWidth = getDimensions('product_width_cm', specs);
      const productDepth = getDimensions('product_depth_cm', specs);

      const diameter = getDimensions('diameter', specs);

      let height;
      let length;
      let width;
      let depth;

      if (assembledHeight || assembledLength || assembledWidth || assembledDepth) {
        height = assembledHeight;
        length = assembledLength;
        width = assembledWidth;
        depth = assembledDepth;
      } else {
        height = productHeight;
        length = productLength;
        width = productWidth;
        depth = productDepth;
      }

      row.height = [{ text: getDigitOnly(height) }];
      row.length = [{ text: getDigitOnly(length) }];
      row.width = [{ text: getDigitOnly(width) }];
      row.depth = [{ text: getDigitOnly(depth) }];
      row.diameter = [{ text: getDigitOnly(diameter) }];

      return text;
    },

    weight_raw: (text, row) => getDigitOnly(
      getSpecs(text, row).find(spec => spec.code.toLowerCase().includes('weight_kg'))?.value,
    ),
    materials: (text, row) => getSpecs(text, row)
      .filter(spec => spec.code.toLowerCase().includes('material'))
      .map(spec => `${spec.label}: ${spec?.value}`)
      .join(', '),
    pack_size: (text, row) => (
      getSpecs(text, row).filter(spec => spec.code.toLowerCase().includes('pieces_qty'))?.value || '1'
    ),
    price: (text, row) => {
      const json = JSON.parse(text);
      const priceFromPage = row.price_from_page?.[0]?.text;
      const originalPrice = json.originalPrice?.value || json.originalPrice?.minPrice;
      const currentPrice = json.currentPrice?.value
        || json.currentPrice?.minPrice
        || priceFromPage;
      console.log(`------------------------------Current price: ${priceFromPage}`);
      // no original price = so current price is normal
      if (!originalPrice) {
        row.original_price = [{ text: String(currentPrice) }];
        row.offer_price = [{ text: null }];
      } else { // if there is original price - it means that product is on sale
        if (!originalPrice && !currentPrice) return;
        row.original_price = [{ text: String(originalPrice) }];
        row.offer_price = [{ text: String(currentPrice) }];
      }
    },
  };

  const mappingFct = (header, arr, row) => [
    ...arr.map(({ text, ...other }) => ({
      text: mapping[header](text, row),
      ...other,
    })),
  ];

  data.forEach(obj => obj.group.forEach(row => Object.keys(row).forEach((header) => {
    // eslint-disable-next-line no-param-reassign
    if (mapping[header]) row[header] = mappingFct(header, row[header], row);
  })));
  return data;
};

module.exports = { cleanUp };
