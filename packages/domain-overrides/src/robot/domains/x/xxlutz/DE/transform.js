/**
 *
 * @param {ImportIO.Group[]} data
 * @returns {ImportIO.Group[]}
 */
const cleanUp = (data) => {
  function cleanURL(url) {
    return url.replace(/\s/g, '').replace(/,/g, '');
  }

  function extractDimensions(str) {
    const arr = str?.split(':');
    const keys = arr?.[0]?.split('/');
    const values = arr?.[1]?.split('/');

    const dimensions = {};
    keys.forEach((key, index) => {
      const dimensionKey = key?.trim();
      const dimensionValue = parseFloat(values[index]?.replace(',', '.')); // Replace comma with dot for proper parsing
      // eslint-disable-next-line no-restricted-globals
      dimensions[dimensionKey] = isNaN(dimensionValue)
        ? null
        : dimensionValue?.toString();
    });

    return dimensions;
  }
  const removeDuplicatesByText = (array) => {
    const uniqueTexts = array.map(item => item.text) // First, get all text values
      .filter((value, index, self) => self.indexOf(value) === index); // Remove duplicates

    return uniqueTexts.map(text => ({ text })); // Map the unique text values back to the original object structure
  };
  const mapping = {
    productURL: text => `https://www.xxxlutz.de${text}`,
    stock_availability: text => (text === 'yes' ? 'yes' : 'no'),
    product_variations: text => `https://www.xxxlutz.de${cleanURL(text)}`,
    material: text => text?.split(':')?.[1] || null,
    height: text => extractDimensions(text)?.Höhe || null,
    width: text => extractDimensions(text)?.Breite || null,
    depth: text => extractDimensions(text)?.Tiefe || null,
    length: text => extractDimensions(text)?.Länge || null,
    diameter: text => extractDimensions(text)?.Durchmesser || null,
    weight_raw: (text, row) => {
      // need only unieqie materials
      // eslint-disable-next-line no-param-reassign
      row.materials = removeDuplicatesByText(row.materials);
    },

  };

  const mappingFct = (header, arr, row) => [...arr.map(({
    text,
    ...other
  }) => ({ text: mapping[header](text, row), ...other }))];

  data.forEach(obj => obj.group.forEach(row => Object.keys(row).forEach((header) => {
    // eslint-disable-next-line no-param-reassign
    if (mapping[header]) row[header] = mappingFct(header, row[header], row);
  })));
  return data;
};

module.exports = { cleanUp };
