/* eslint-disable no-param-reassign */
/**
 *
 * @param {ImportIO.Group[]} data
 * @returns {ImportIO.Group[]}
 */
const cleanUp = (data) => {
  const fixDimension = (text) => {
    const clean = text
      .replace(/\s?f(ee)?t\.?\s?/g, "'")
      .replace(/in\./g, '')
      .replace(/[^\d.' ]/g, '');
    if (!clean.match(/\d/)) return null;
    const [feet, inches] = clean
      .split(/'/)
      .map(n => Number(n));
    if (!inches) return Number.isNaN(feet) ? null : String(feet);
    return String(feet * 12 + inches);
  };
  const detectUnit = text => (text.match(/cm/) ? 'cm' : 'in');
  const checkEmpty = (dimension) => {
    if (!dimension) return true;
    return dimension?.[0]?.text === 'Not Applicable';
  };
  const extractDimensions = (text, row) => {
    if (text && checkEmpty(row.width) && checkEmpty(row.height) && checkEmpty(row.length)) {
      const regex = /([\d'.]+)(\s*(in(che?s?)?|\\?")\s*)?/;
      const matches = text
        .replace(/\s?f(ee)?t\.?\s?/g, "'")
        .match(RegExp(regex, 'g'))
        ?.map(group => group.match(RegExp(regex))?.[1]) || [];
      const [length, width, height] = matches;
      if (length) {
        row.length = [{ text: fixDimension(length) }];
        row.dimensions_unit = [{ text: detectUnit(text) }];
      }
      if (width) {
        row.width = [{ text: fixDimension(width) }];
      }
      if (height) {
        row.height = [{ text: fixDimension(height) }];
      }
    }
    return text;
  };
  const mapping = {
    offer_price: (text, row) => {
      if (!row.original_price) {
        row.original_price = [{ text }];
        return null;
      }
      return text;
    },
    product_title: (text, row) => {
      const packSize = text.match(/Pack of (\d+)/)?.[1];
      if (packSize && checkEmpty(row.pack_size)) {
        row.pack_size = [{ text: packSize }];
      }
      return text;
    },
    stock_availability: text => (text.includes('InStock') ? '1' : '0'),
    productURL: text => (text.split('/').filter(Boolean).pop()),
    depth: text => fixDimension(text),
    diameter: text => fixDimension(text),
    length: text => fixDimension(text),
    width: text => fixDimension(text),
    height: text => fixDimension(text),
    weight_raw: text => fixDimension(text),
    product_variations_raw: (text, row) => {
      const parsed = JSON.parse(text) || {};
      const idList = Object.entries(parsed).map(x => x?.[1]);
      if (idList.length > 0) {
        row.product_variations = [];
        idList.forEach(id => row.product_variations.push({ text: `https://www.walmart.ca/en/ip//${id}` }));
      }
    },
    size_raw: (text, row) => extractDimensions(text, row),
    description: (text, row) => {
      extractDimensions(text.match(/([Dd]imensions|[Ss]ize)\s*[^ :]*:([HWL '"x\d.]+(cm|in)?)/)?.[2], row);
      extractDimensions(text.match(/([Mm]easurements)\s*[^ :]*:[^/]+\/([HWL '"x\d.]+)in/)?.[2], row);
      const [weightMatch, weightValue, weightUnit] = text.match(/[Ww]eight[^:]*:\s*([\d.]+)\s*(lbs|k?g)?$/) ?? [];
      if (weightMatch && !row.weight_raw) {
        row.weight_raw = [{ text: fixDimension(weightValue) }];
        row.weight_unit = [{ text: weightUnit ?? 'lbs' }];
      }
      if (!row.materials) {
        const materialsRegex = /[Mm]aterial:\s*([\w ]+)/;
        const match = text.match(materialsRegex);
        if (match?.[1]) {
          row.materials = [{ text: match?.[1] }];
        }
      }
      return text.replace(/<[^>]+>/g, '');
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
