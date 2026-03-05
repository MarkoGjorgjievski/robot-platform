/* eslint-disable no-param-reassign
 */
/**
 *
 * @param {ImportIO.Group[]} data
 * @returns {ImportIO.Group[]}
 */

const cleanUp = (data) => {
  const mapping = {
    offer_price: (text) => {
      text = text.replace(',', '.');
      text = text.match(/(\d+\.\d{1,2})|(\d+)/)?.[0];
      return text;
    },
    original_price: (text, row) => {
      text = text.replace(',', '.');
      text = text.match(/(\d+\.\d{1,2})|(\d+)/)?.[0];
      if (text === undefined || text === '0') text = row.offer_price?.[0].text;
      return text;
    },
    product_details_dimensions: (text, row) => {
      if (!row.height?.[0]?.text && !row.width?.[0]?.text && !row.length?.[0]?.text) {
        const dimension = text.replace(/,/g, '.');
        const formatDimension = dimension.match(/(Mått: ((\d+.\d+)|(\d+)) x ((\d+.\d+)|(\d+)) x ((\d+.\d+)|(\d+))(?= cm))/g)?.[0];

        if (formatDimension !== undefined) {
          const height = text.match(/(?<=Mått: )((\d+.\d+)|(\d+))(?= x)/g)?.[0];
          const width = text.match(/(?<=x )((\d+.\d+)|(\d+))(?= x)/g)?.[0];
          const length = text.match(/(?<=x )((\d+.\d+)|(\d+))(?= cm)/g)?.[0];
          // const unit = text.match(/([a-zA-Z]+$)/g)?.[0];
          if (height !== undefined) row.height = [{ text: `${height}` }];
          if (width !== undefined) row.width = [{ text: `${width}` }];
          if (length !== undefined) row.length = [{ text: `${length}` }];
          // if (unit !== undefined) row.dimensions_unit = [{ text: `${unit}` }];
        }
      }
      if (!row.colour?.[0]?.text) {
        const colour = text.match(/(?<=Färg:\s)(.*)/g)?.[0];
        if (colour !== undefined) row.colour = [{ text: `${colour}` }];
      }
      if (!row.materials?.[0]?.text) {
        const materials = text.match(/(?<=Material:\s)(.*)/g)?.[0];
        if (materials !== undefined) row.materials = [{ text: `${materials}` }];
      }
      return text;
    },
    average_rating: (text) => {
      text = parseFloat(text).toFixed(1);
      return text;
    },
  };

  const mappingFct = (header, arr, row) => arr.map(({ text, ...other }) => ({
    text: mapping[header](text, row),
    ...other,
  }));

  data.forEach(obj => obj.group.forEach(row => Object.keys(row).forEach((header) => {
    // eslint-disable-next-line no-param-reassign
    if (mapping[header]) row[header] = mappingFct(header, row[header], row);
  })));

  return data;
};

module.exports = { cleanUp };
