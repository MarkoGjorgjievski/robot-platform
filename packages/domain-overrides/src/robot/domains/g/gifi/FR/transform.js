/**
 *
 * @param {ImportIO.Group[]} data
 * @returns {ImportIO.Group[]}
 */

const cleanUp = (data) => {
  const anyDimensionRegex = /[ØøHhLlPp]\.?\s*([\d,.]+)/m;
  const unlabeledDimensionRegex = /(?<length>\d+,?\d*)[^\d]+(?<width>\d+,?\d*)?[^\d]+(?<height>\d+,?\d*)?/m;
  const mapping = {
    offer_price: (text, row) => ((Number(row.original_price?.[0]?.text) === Number(text)) ? null : text),
    length: (text, row) => {
      if (text === 'null') {
        let dimensions = null;
        if (row.dimensions_raw?.[0]?.text !== undefined) {
          dimensions = row.dimensions_raw?.[0]?.text;
        } else if (row.dimensions_raw_backup?.[0]?.text !== undefined) {
          dimensions = row.dimensions_raw_backup?.[0]?.text;
        }
        if (dimensions !== null) {
          let match = dimensions.match(/L\.?\s*(\d[\d,.]*)/m); // check if labeled length dimension is present
          if (match) { return match[1].replace(/,/g, '.'); } // if yes then return it's value
          if (!dimensions.match(anyDimensionRegex)) { // if no other labeled values found
            match = row.dimensions_raw?.[0]?.text.match(unlabeledDimensionRegex);
            return match?.groups?.length ? match.groups.length.replace(/,/g, '.') : null; // return the first one
          }
        }
        return null;
      }
      return text.replace(/,/g, '.');
    },
    width: (text, row) => {
      if (text === 'null') {
        let dimensions = null;
        if (row.dimensions_raw?.[0]?.text !== undefined) {
          dimensions = row.dimensions_raw?.[0]?.text;
        } else if (row.dimensions_raw_backup?.[0]?.text !== undefined) {
          dimensions = row.dimensions_raw_backup?.[0]?.text;
        }
        if (dimensions !== null) {
          let match = dimensions.match(/l\.?\s*(\d[\d,.]*)/m); // check if labeled width dimension is present
          if (match) { return match[1].replace(/,/g, '.'); } // if yes then return it's value

          if (!dimensions.match(anyDimensionRegex)) { // if no other labeled values found
            match = row.dimensions_raw?.[0]?.text.match(unlabeledDimensionRegex);
            return match?.groups?.width ? match.groups.width.replace(/,/g, '.') : null; // return the second one
          }
        }
        return null;
      }
      return text.replace(/,/g, '.');
    },
    height: (text, row) => {
      if (text === 'null') {
        let dimensions = null;
        if (row.dimensions_raw?.[0]?.text !== undefined) {
          dimensions = row.dimensions_raw?.[0]?.text;
        } else if (row.dimensions_raw_backup?.[0]?.text !== undefined) {
          dimensions = row.dimensions_raw_backup?.[0]?.text;
        }
        if (dimensions !== null) {
          let match = dimensions.match(/[Hh]\.?\s*(\d[\d,.]*)/m); // check if labeled height dimension is present
          if (match) { return String(match[1]).replace(/,/g, '.'); } // if yes then return it's value
          if (!dimensions.match(anyDimensionRegex)) { // if no other labeled values found
            match = row.dimensions_raw?.[0]?.text.match(unlabeledDimensionRegex);
            return match?.groups?.height ? String(match.groups.height).replace(/,/g, '.') : null; // return the first one
          }
        }
        return null;
      }
      return text.replace(/,/g, '.');
    },
    depth: (text, row) => {
      if (text === 'null') {
        let dimensions = null;
        if (row.dimensions_raw?.[0]?.text !== undefined) {
          dimensions = row.dimensions_raw?.[0]?.text;
        } else if (row.dimensions_raw_backup?.[0]?.text !== undefined) {
          dimensions = row.dimensions_raw_backup?.[0]?.text;
        }
        if (dimensions !== null) {
          const match = dimensions.match(/[Pp]\.?\s*(\d[\d,.]*)/m); // check if labeled depth dimension is present
          if (match) { return match[1].replace(/,/g, '.'); } // if yes then return it's value
        }
        return null;
      }
      return text.replace(/,/g, '.');
    },
    diameter: (text, row) => {
      if (text === 'null') {
        let dimensions = null;
        if (row.dimensions_raw?.[0]?.text !== undefined) {
          dimensions = row.dimensions_raw?.[0]?.text;
        } else if (row.dimensions_raw_backup?.[0]?.text !== undefined) {
          dimensions = row.dimensions_raw_backup?.[0]?.text;
        }
        if (dimensions !== null) {
          const match = dimensions.match(/[Øø]\.?\s*(\d[\d,.]*)/m); // check if labeled diameter dimension is present
          if (match) { return match[1].replace(/,/g, '.'); } // if yes then return it's value
        }
        return null;
      }
      return text.replace(/,/g, '.');
    },
    weight_raw: text => (text.replace(/,/g, '.')),
    pack_size: (text, row) => {
      if (text === 'null') {
        if (row.pack_size_backup?.[0]?.text !== undefined) { return row.pack_size_backup?.[0]?.text; }
        return null;
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
