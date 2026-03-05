/* eslint-disable no-param-reassign */
/**
 *
 * @param {ImportIO.Group[]} data
 * @returns {ImportIO.Group[]}
 */
const cleanUp = (data) => {
  function extractDimension(dimensionString) {
    if (dimensionString === undefined) return null;
    const regex = /(\d+(\.\d+)?)/;
    const match = dimensionString.match(regex);
    return match ? match[0] : null;
  }
  function getDimension(text, dimensionName) {
    const dimensions = text.split('x').map(dimension => dimension.trim());
    switch (dimensionName) {
      case 'h':
        return extractDimension(dimensions[0]);
      case 'w':
        return extractDimension(dimensions[1]);
      case 'd':
        return extractDimension(dimensions[2]);
      default:
        return null;
    }
  }
  const mapping = {
    productURL: text => `https://www.saco.sa${text}`,
    original_price: (text, row) => {
      if (text === 'dummy') {
        const price = row.offer_price?.[0]?.text;
        row.offer_price[0].text = null;
        return price;
      }
      const match = text.match(/\d+(?:,\d{3})*(?:\.\d{2})?/);
      return match ? match[0].replace(/,/g, '') : row.offer_price?.[0]?.text;
    },
    dimensions_unit: (text) => {
      const newText = text.replace(/[^a-zA-Z]/g, '');
      if (newText === 'cn') {
        return 'cm';
      }
      if (newText === 'inch') {
        return 'in';
      }
      return newText;
    },
    weight_unit: (text) => {
      const newText = text.replace(/[^a-zA-Z]/g, '');
      return newText === 'pound' || newText === 'lb' || newText === 'pounds' ? 'lbs' : newText;
    },
    width: (text, row) => {
      if (text !== 'dummy') return text;
      return row.dimensions_data?.[0]?.text && getDimension(row.dimensions_data?.[0]?.text, 'w');
    },
    height: (text, row) => {
      if (text !== 'dummy') return text;
      return row.dimensions_data?.[0]?.text && getDimension(row.dimensions_data?.[0]?.text, 'h');
    },
    depth: (text, row) => {
      if (text !== 'dummy') return text;
      return row.dimensions_data?.[0]?.text && getDimension(row.dimensions_data?.[0]?.text, 'd');
    },
  };

  const mappingFct = (header, arr, row) => [...arr.map(({ text, ...other }) => ({ text: mapping[header](text, row), ...other }))];

  data.forEach(obj => obj.group.forEach(row => Object.keys(row).forEach((header) => {
    // eslint-disable-next-line no-param-reassign
    if (mapping[header]) row[header] = mappingFct(header, row[header], row);
  })));
  return data;
};

module.exports = { cleanUp };
