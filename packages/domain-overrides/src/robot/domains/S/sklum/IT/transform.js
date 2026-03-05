/* eslint-disable no-param-reassign */
/* eslint-disable linebreak-style */
/**
 *
 * @param {ImportIO.Group[]} data
 * @returns {ImportIO.Group[]}
 */

const cleanUp = (data) => {
  const mapping = {
    product_title: (text, row) => {
      const weight = row.weight_raw?.[0].text;
      const height = row.height?.[0].text;
      const width = row.width?.[0].text;
      const depth = row.depth?.[0].text;
      const length = row.length?.[0].text;
      const diameter = row.diameter?.[0].text;
      const productDiffrentDimencions = row.productDimencions?.[0].text;

      if (weight) {
        row.weight_raw = [{ text: weight.replace(/,\s|,/g, '.').replace(/[a-z]/g, '').match(/\d\S*/g)[0] }];
      }
      if (height) {
        row.height = [{ text: height.replace(/,\s|,/g, '.').replace(/[a-z]/g, '').match(/\d\S*/g)[0] }];
      }
      if (width) {
        row.width = [{ text: width.replace(/,\s|,/g, '.').replace(/[a-z]/g, '').match(/\d\S*/g)[0] }];
      }
      if (depth) {
        row.depth = [{ text: depth.replace(/,\s|,/g, '.').replace(/[a-z]/g, '').match(/\d\S*/g)[0] }];
      }
      if (length) {
        row.length = [{ text: length.replace(/,\s|,/g, '.').replace(/[a-z]/g, '').match(/\d\S*/g)[0] }];
      }
      if (diameter) {
        row.diameter = [{ text: diameter.replace(/,\s|,/g, '.').replace(/[a-z]/g, '').match(/\d\S*/g)[0] }];
      }

      if (!productDiffrentDimencions) {
        return text;
      }

      if (productDiffrentDimencions.includes('Ø')) {
        row.diameter = [{ text: productDiffrentDimencions.replace(/,\s|,/g, '.').replace(/[a-z]/g, '').match(/\d\S*/g)[0] }];
        return text;
      }

      if (productDiffrentDimencions.includes('↑')) {
        row.height = [{ text: productDiffrentDimencions.replace(/,\s|,/g, '.').replace(/[a-z]/g, '').match(/\d\S*/g)[0] }];
        return text;
      }

      if (productDiffrentDimencions.includes('↔︎')) {
        row.width = [{ text: productDiffrentDimencions.replace(/,\s|,/g, '.').replace(/[a-z]/g, '').match(/\d\S*/g)[0] }];
        return text;
      }

      if (productDiffrentDimencions.match(/\d\S*\sx\s\d\S*/)) {
        row.width = [{ text: productDiffrentDimencions.replace(/,\s|,/g, '.').replace(/[a-z]/g, '').match(/\d\S*/g)[0] }];
        row.length = [{ text: productDiffrentDimencions.replace(/,\s|,/g, '.').replace(/[a-z]/g, '').match(/\d\S*/g)[1] }];
        row.dimensions_unit = [{ text: productDiffrentDimencions.replace(/x/g, ' ').match(/[a-z]+/g)[0] }];
        return text;
      }

      return text;
    },
    product_variations_JSON: (text, row) => {
      const productVariationsJSON = JSON.parse(text);
      const baseURL = row.baseURL?.[0].text;
      const productVariations = [];

      // eslint-disable-next-line array-callback-return
      productVariationsJSON.map((product) => {
        const productsId = product.sku.match(/(?<=-)(.*)(?=-)/)[0];
        productVariations.push({ text: `${baseURL}?id_c=${productsId}` });
      });

      row.product_variations = productVariations;
    },
    productDimensions: (text, row) => {
      const textWithSapce = text.replace(/x/g, ' ');
      if (row.height || row.width || row.length) return text;

      row.height = [{ text: textWithSapce.replace(/,\s|,/g, '.').replace(/[a-z]/g, ' ').match(/\d\S*/)[2] }];
      row.width = [{ text: textWithSapce.replace(/,\s|,/g, '.').replace(/[a-z]/g, ' ').match(/\d\S*/g)[1] }];
      row.length = [{ text: textWithSapce.replace(/,\s|,/g, '.').replace(/[a-z]/g, ' ').match(/\d\S*/g)[0] }];
      row.dimensions_unit = [{ text: textWithSapce.match(/[a-z]+/g)[0] }];
      return text;
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
