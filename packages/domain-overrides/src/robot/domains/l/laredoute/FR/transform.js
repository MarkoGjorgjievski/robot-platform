/* eslint-disable no-param-reassign */
/**
 *
 * @param {ImportIO.Group[]} data
 * @returns {ImportIO.Group[]}
 */
const cleanUp = (data) => {
  const extractDimensionValue = (text, dimensionName) => {
    if (!text) return;
    const caseInsensitive = 'i';
    const dimensionRegex = new RegExp(`${dimensionName}\\s*(\\d+(\\.\\d+)?)`, caseInsensitive);
    const match = text.match(dimensionRegex);

    // eslint-disable-next-line consistent-return
    return match && match[1] ? match[1] : null;
  };

  const mapping = {
    productURL: text => `https://www.laredoute.fr${text}`,
    product_variations_colors: (text, row) => row.product_variations.push({ text: `${row.base_url?.[0]?.text}?dim1=${text}&dim2=1000` }),
    product_variations_size: (text, row) => row.product_variations.push({ text: `${row.base_url?.[0]?.text}?dim1=1000&dim2=${text}` }),
    product_variations: text => (text === 'dummy' ? null : text),
    original_price: (text, row) => {
      if (text !== 'dummy') return text;
      const price = row.offer_price?.[0]?.text;
      row.offer_price[0].text = null;
      return price;
    },
    weight_raw: (text, row) => {
      if (text === 'dummy' || text === '.') {
        return extractDimensionValue(row.dimensions_data?.[0]?.text, 'Poids');
      }
      return text;
    },
    height: (text, row) => {
      if (text === 'dummy' || text === 'Taille Unique') {
        return extractDimensionValue(row.dimensions_data?.[0]?.text, 'Hauteur');
      }
      const dimensionsArray = text.split(',');
      const largestDimensions = dimensionsArray[dimensionsArray.length - 1];
      const matches = largestDimensions.match(/\d+/g);
      return matches ? matches[0] : null;
    },
    width: (text, row) => {
      if (text === 'dummy' || text === 'Taille Unique') {
        return extractDimensionValue(row.dimensions_data?.[0]?.text, 'Largeur');
      }
      const dimensionsArray = text.split(',');
      const largestDimensions = dimensionsArray[dimensionsArray.length - 1];
      const matches = largestDimensions.match(/\d+/g);
      return matches ? matches[1] : null;
    },
    depth: (text, row) => {
      if (text === 'dummy') {
        return extractDimensionValue(row.dimensions_data?.[0]?.text, 'Profondeur');
      }
      return text;
    },
    length: (text, row) => {
      if (text === 'dummy') {
        return extractDimensionValue(row.dimensions_data?.[0]?.text, 'Longueur');
      }
      return text;
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
