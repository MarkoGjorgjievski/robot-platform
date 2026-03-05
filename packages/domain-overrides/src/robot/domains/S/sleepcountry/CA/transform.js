/* eslint-disable no-unused-vars */
/* eslint-disable no-param-reassign */
/**
 *
 * @param {ImportIO.Group[]} data
 * @returns {ImportIO.Group[]}
 */
const cleanUp = (data, parameters, context) => {
  function extractDimensions(dimString) {
    // This regex matches numbers (including decimal points) followed by a unit (L, W, H)
    const regex = /(\d+(?:\.\d+)?)"([LWH])/gi;
    let match;
    const dimensions = {};

    // eslint-disable-next-line no-cond-assign
    while ((match = regex.exec(dimString)) !== null) {
      // match[1] is the numeric value, match[2] is the dimension type (L, W, or H)
      const value = parseFloat(match[1]);
      const dimensionType = match[2].toUpperCase(); // Normalize to uppercase

      // eslint-disable-next-line default-case
      switch (dimensionType) {
        case 'L':
          dimensions.length = value;
          break;
        case 'W':
          dimensions.width = value;
          break;
        case 'H':
          dimensions.height = value;
          break;
      }
    }

    return dimensions;
  }

  function extractMaterials(text) {
    // Define a regex pattern to capture a wider range of common material names
    const regex = /\b(cotton|polyester|wool|silk|linen|nylon|leather|suede|viscose|spandex|elastane|rayon|bamboo|velvet|denim|satin|chiffon|crepe|twill|flannel|microfiber|cashmere|modal|lyocell|jute|hemp)\b/gi;

    // Search for all matches in the text
    const matches = text.match(regex);

    // Return unique materials found or an empty array if none
    return matches
      ? Array.from(new Set(matches.map(material => material.toLowerCase())))
      : [];
  }
  // eslint-disable-next-line no-unsafe-optional-chaining
  const mapping = {
    // eslint-disable-next-line no-unsafe-optional-chaining
    // product_variations: (row, text) => row?.actualUrl?.[0]?.text + text,
    stock_availability: text => (text === 'no' ? 'no' : 'yes'),
    height: text => extractDimensions(text)?.height?.toString(),
    width: text => extractDimensions(text)?.width?.toString(),
    length: text => extractDimensions(text)?.length?.toString(),
    original_price: text => text?.replace(',', ''),
    materialMod: (text, row) => {
      if (typeof extractMaterials(text) === 'string') {
        row.materials = [{ text: extractMaterials(text) }];
      } else {
        row.materials = [{ text: null }];
      }
    },
    product_variations: (text, row) => `${row?.UrlSM?.[0]?.text}?variant=${text.replace(' ', '')}`,
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
