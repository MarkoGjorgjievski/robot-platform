/* eslint-disable no-param-reassign */
/**
 *
 * @param {ImportIO.Group[]} data
 * @returns {ImportIO.Group[]}
 */
const cleanUp = (data) => {
  const mapping = {
    firstDepthURL: (text) => {
      console.log('BLAAA');
      return text;
    },
    current_price: (text, row) => {
      const crossedPrice = row.crossed_price?.[0]?.text;
      if (crossedPrice) {
        row.original_price = [{ text: crossedPrice }];
        row.offer_price = [{ text }];
      } else {
        row.original_price = [{ text }];
        row.offer_price = null;
      }

      return text;
    },
    pack_size: (text) => {
      const regex = /(\d+) szt/;
      const match = regex.exec(text);
      if (match) {
        return match[1];
      }
      return '1';
    },
    dimensions_aggregated: (text, row) => {
      const regex = /(?<width>\d+)(x(?<height>\d+)(x(?<depth>\d+))?)?/i;
      const match = regex.exec(text);

      if (!match) return text;

      const { width, height, depth } = match.groups;

      row.width = [{ text: width }];
      row.height = [{ text: height }];
      row.depth = [{ text: depth }];

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
