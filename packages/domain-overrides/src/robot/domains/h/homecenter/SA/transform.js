/* eslint-disable no-param-reassign */
/* eslint-disable linebreak-style */
/**
 *
 * @param {ImportIO.Group[]} data
 * @returns {ImportIO.Group[]}
 */

const cleanUp = (data) => {
  const mapping = {
    offer_price: (text, row) => {
      const newPrice = row.original_price?.[0].text;
      row.original_price = [{ text }];

      return newPrice;
    },
    product_variations: (text, row) => {
      const url = row.productUrl?.[0].text;
      const urlBase = url.match(/(.*)(?=\/p\/)/g)[0];

      if (text === url.match(/\/p\/(.*)/g)[0]) return;

      // eslint-disable-next-line consistent-return
      return `${urlBase}${text}`;
    },
    listing_id: (text, row) => {
      const packDimensions = row.pack_dimensions;
      if (!packDimensions) return text;
      const packDimensionsText = packDimensions[0].text.toLowerCase();
      if (packDimensionsText.includes('length') && packDimensionsText.includes('width') && packDimensionsText.includes('height')) {
        row.length = [{ text: `${packDimensionsText.match(/(?<=length)\D*(\d\S*)/g)?.[0].match(/\d\S*/g)?.[0]}` }];
        row.width = [{ text: `${packDimensionsText.match(/(?<=width)\D*(\d\S*)/g)?.[0].match(/\d\S*/g)?.[0]}` }];
        row.height = [{ text: `${packDimensionsText.match(/(?<=height)\D*(\d\S*)/g)?.[0].match(/\d\S*/g)?.[0]}` }];

        return text;
      }

      if (packDimensionsText.includes('length') && packDimensionsText.includes('width')) {
        row.length = [{ text: `${packDimensionsText.match(/(?<=length)\D*(\d\S*)/g)?.[0].match(/\d\S*/g)?.[0]}` }];
        row.width = [{ text: `${packDimensionsText.match(/(?<=width)\D*(\d\S*)/g)?.[0].match(/\d\S*/g)?.[0]}` }];

        return text;
      }

      if (packDimensionsText.includes('length') && packDimensionsText.includes('height')) {
        row.length = [{ text: `${packDimensionsText.match(/(?<=length)\D*(\d\S*)/g)?.[0].match(/\d\S*/g)?.[0]}` }];
        row.height = [{ text: `${packDimensionsText.match(/(?<=height)\D*(\d\S*)/g)?.[0].match(/\d\S*/g)?.[0]}` }];

        return text;
      }

      if (packDimensionsText.includes('length')) {
        row.length = [{ text: `${packDimensionsText.match(/(?<=length)\D*(\d\S*)/g)?.[0].match(/\d\S*/g)?.[0]}` }];

        return text;
      }

      if (packDimensionsText.match(/(.*)l\sx\s(.*)w\sx\s(.*)h\sx\s(.*)/g)) {
        row.length = [{ text: `${packDimensionsText.match(/\d\S*/g)?.[0]}` }];
        row.width = [{ text: `${packDimensionsText.match(/\d\S*/g)?.[1]}` }];
        row.height = [{ text: `${packDimensionsText.match(/\d\S*/g)?.[2]}` }];

        return text;
      }
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
//
