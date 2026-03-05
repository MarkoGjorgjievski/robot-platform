/* eslint-disable no-param-reassign */
/**
 *
 * @param {ImportIO.Group[]} data
 * @returns {ImportIO.Group[]}
 */
const cleanUp = (data) => {
  const reviewsRegex = '((d+))';
  const reviewsRatingRegex = '^([\\d.]+)\\s';

  function extractPackSize(productTitle) {
    // Regular expression to match "set van x" pattern
    const packSizeRegex = /set van (\d+)/i;

    // Match the pattern in the product title
    const match = productTitle.match(packSizeRegex);

    if (match && match[1]) {
      // Extracted pack size found, return as integer
      return parseInt(match[1], 10);
    }
    // No pack size found, return null
    return null;
  }
  function parseDimensions(dimStr) {
    const parts = dimStr
      .replace(',', '.')
      ?.replace(/^\D+/, '')
      ?.split(/x|\s/)
      ?.filter(Boolean);
    const regex = /(\d+)x(\d+)/;
    const match = dimStr.match(regex);
    if (dimStr.includes('ø') && match && match.length === 3) {
      const length = parseInt(match[1], 10);
      const diameter = parseInt(match[2], 10);
      return { length, diameter };
    }

    // Function to handle ranges or alternatives
    const handleRangeOrAlternative = (str) => {
      if (str.includes('-')) {
        // Split the range and return the larger number
        const rangeParts = str.split('-').map(Number);
        return Math.max(...rangeParts).toString();
      }
      if (str.includes('/')) {
        const rangeParts = str.split('/').map(Number);
        return Math.max(...rangeParts).toString();
      }
      return str; // return as a string for consistency
    };

    // Apply the function to each part
    const dimensions = parts?.map(handleRangeOrAlternative);

    // Return an object with width, length, and height
    return {
      width: dimensions?.[1] !== '' ? dimensions?.[1] : null,
      length: dimensions?.[0] !== '' ? dimensions?.[0] : null,
      height: dimensions?.[2] !== '' ? dimensions?.[2] : null,
    };
  }

  const mapping = {
    stock_availability: text => (text === 'yes' ? 'yes' : 'no'),
    user_reviews: (text) => {
      const match = text.match(reviewsRegex);
      return match ? match[1] : '0';
    },
    product_variations: text => `https://www.leenbakker.nl/${text}`,
    average_rating: (text) => {
      const match = text.match(reviewsRatingRegex);
      return match ? match[1] : null;
    },
    pack_size: text => extractPackSize(text),
    dimensions_unit: (text) => {
      const cmPattern = /\bcm\b/;
      const mmPattern = /\bmm\b/;
      const inchesPattern = /\binches\b|\bin\b/;
      const ftPattern = /\bft\b/;

      // Check if the text contains these units
      if (cmPattern.test(text)) {
        return 'cm';
      }
      if (mmPattern.test(text)) {
        return 'mm';
      }
      if (inchesPattern.test(text)) {
        return 'in';
      }
      if (ftPattern.test(text)) {
        return 'ft';
      }
      return 'cm'; // Default to 'cm' if no match is found
    },
    height: text => (!Number.isNaN(+(parseDimensions(text)?.height || 0))
      ? parseDimensions(text)?.height
      : null),
    width: text => (!Number.isNaN(+(parseDimensions(text)?.width || 0))
      ? parseDimensions(text)?.width
      : null),
    length: text => (!Number.isNaN(+(parseDimensions(text)?.length || 0))
      ? parseDimensions(text)?.length
      : null),
    diameter: text => (!Number.isNaN(+(parseDimensions(text)?.diameter || 0))
      ? parseDimensions(text)?.diameter
      : null),
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
//
