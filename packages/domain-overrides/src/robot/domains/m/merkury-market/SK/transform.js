/* eslint-disable no-param-reassign */
/**
 *
 * @param {ImportIO.Group[]} data
 * @returns {ImportIO.Group[]}
 */
const cleanUp = (data) => {
  const mapping = {
    materials: text => text.replace(/\n/g, ''),
    pack_size: (text) => {
      const regex = /(?<numberOfItems>\d+)\s?ks/;
      const match = regex.exec(text);
      if (!match) return '1';

      const { numberOfItems } = match.groups;
      return numberOfItems;
    },

    current_price: (text, row) => {
      const oldPrice = row.old_price?.[0]?.text;
      if (oldPrice) {
        row.original_price = [{ text: oldPrice }];
        row.offer_price = [{ text }];
      } else {
        row.original_price = [{ text }];
      }
    },
    // cm
    height_cm: (text, row) => {
      row.height = [{ text }];
    },
    width_cm: (text, row) => {
      row.width = [{ text }];
    },
    length_cm: (text, row) => {
      row.length = [{ text }];
    },
    depth_cm: (text, row) => {
      row.depth = [{ text }];
    },
    diameter_cm: (text, row) => {
      row.diameter = [{ text }];
    },
    // mm
    height_mm: (text, row) => {
      const value = parseFloat(text) / 100;
      row.height = [{ text: value }];
    },
    width_mm: (text, row) => {
      const value = parseFloat(text) / 100;
      row.width = [{ text: value }];
    },
    length_mm: (text, row) => {
      const value = parseFloat(text) / 100;
      row.length = [{ text: value }];
    },
    depth_mm: (text, row) => {
      const value = parseFloat(text) / 100;
      row.depth = [{ text: value }];
    },
    diameter_mm: (text, row) => {
      const value = parseFloat(text) / 100;
      row.diameter = [{ text: value }];
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
