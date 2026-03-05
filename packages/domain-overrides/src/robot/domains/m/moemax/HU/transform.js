/**
 *
 * @param {ImportIO.Group[]} data
 * @returns {ImportIO.Group[]}
 */

/* eslint-disable no-return-assign */
/* eslint-disable no-param-reassign */
const cleanUp = (data) => {
  const sizeDimensions = {
    szélesség: 'width',
    magasság: 'height',
    mélység: 'depth',
    hosszúság: 'length',
    átmérő: 'diameter',
    sarokméret: ['width', 'length'],
    fekvőfelület: ['width', 'length'],
    súly: 'weight_raw',
  };

  const parseDimensions = (row) => {
    const size = row.dimensions[0]?.text;
    if (!size) return;

    const split = size.split(':');
    if (split[0] === size) return;

    const dimensions = split[0].trim();
    const valuesAndDimensionUnit = split[1].trim();
    const values = valuesAndDimensionUnit.split(' ');
    const unit = values.pop();
    const dimensionKeys = dimensions.split('/');
    const dimensionValues = values[0].split('/');

    const keyToRowProp = dimensionKeys.map(key => sizeDimensions[key]).flat();
    const parsedValues = dimensionValues.map(
      value => value.match(/^[\d,.]+/)[0],
    );

    keyToRowProp.map(
      (key, index) => (row[key] = [{ text: parsedValues[index] }]),
    );

    if (unit === 'kg' || unit === 'g') {
      row.weight_unit = [{ text: unit }];
    } else {
      row.dimensions_unit = [{ text: unit || 'cm' }];
    }
    row.dimensions = null;
  };

  const parseTitleForPackSize = (title) => {
    const regex = /\d+(?=\s*Részes|\d*db)/g;
    const matches = title.match(regex);
    return matches ? matches[0] : '1';
  };

  const mapping = {
    main_image: (text, row) => {
      if (row.alternative_images && row?.alternative_images?.length > 1) {
        row.alternative_images.shift();
      }
      return text;
    },
    product_variations: (text) => {
      const gap = text.split(' ');
      return gap.length > 1 ? gap.join('%') : text;
    },
    pack_size: text => parseTitleForPackSize(text),
    dimensions: (_, row) => parseDimensions(row),
    stock_availability: text => (text === 'Kosárba' ? 'yes' : 'no'),
    colour: (text, row) => {
      let jsonColor = '';
      if (row.json_data) {
        jsonColor = JSON.parse(row.json_data[0].text).color;
      }

      return jsonColor || (Object.keys(sizeDimensions).find(size => text.includes(size)) ? null : text);
    },
    listing_id: text => text.split('-')[text.split('-').length - 1],
  };

  const mappingFct = (header, arr, row) => [...arr.map(({ text, ...other }) => ({ text: mapping[header](text, row), ...other }))];

  data.forEach(obj => obj.group.forEach(row => Object.keys(row).forEach((header) => {
    // eslint-disable-next-line no-param-reassign
    if (mapping[header]) row[header] = mappingFct(header, row[header], row);
  })));
  return data;
};

module.exports = { cleanUp };
