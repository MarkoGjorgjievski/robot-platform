/* eslint-disable no-param-reassign */
/**
 *
 * @param {ImportIO.Group[]} data
 * @returns {ImportIO.Group[]}
 */
const cleanUp = (data) => {
  const mapping = {
    offer_price: (text, row) => {
      if (!(row?.original_price)) {
        row.original_price = [{ text }];
        return null;
      }
      return text;
    },
    stock_availability: (text) => {
      if (text === 'http://schema.org/InStock') return 'yes';
      return 'no';
    },
    alternative_images: text => text.replace(/\/\?.*$/, ''),
    colour_backup: (text, row) => {
      if (!row.colour) row.colour = [{ text }];
      return null;
    },
    dimensions_raw: (text, row) => {
      const dimensionsUnit = text.match(/\w+$/);
      row.dimensions_unit = [{ text: dimensionsUnit[0] }];
      const dimensionsRaw = text.replace(/\w+$/, '');

      const splitter = dimensionsRaw.split(': ');
      const dimensionNames = splitter[0].split('/');
      const dimensionValues = splitter[1].split('/');

      const dimensionValuesProcessed = dimensionValues.map((value) => {
        // remove whitespaces
        value = value.trim();

        // if a dimension contains a -, it is a range, so we split it and take the last value
        if (value.includes('-')) {
          return value.split('-')[1];
        }
        return value;
      });

      const dimensions = dimensionNames.map((name, i) => ({
        name,
        value: dimensionValuesProcessed[i],
      }));
      if (!row.height && !row.width && !row.length && !row.depth && !row.diameter) {
        row.height = [{ text: dimensions.find(({ name }) => name === 'výška')?.value }];
        row.width = [{ text: dimensions.find(({ name }) => name === 'šírka')?.value }];
        row.length = [{ text: dimensions.find(({ name }) => name === 'dĺžka')?.value }];
        row.depth = [{ text: dimensions.find(({ name }) => name === 'hĺbka')?.value }];
        row.diameter = [{ text: dimensions.find(({ name }) => name === 'priemer')?.value }];
      }
    },
  };
  const mappingFct = (header, arr, row) => [...arr.map(({ text, ...other }) => ({ text: mapping[header](text, row), ...other }))];
  data.forEach(obj => obj.group.forEach(row => Object.keys(row).forEach((header) => {
    if (mapping[header]) row[header] = mappingFct(header, row[header], row);
  })));
  return data;
};

module.exports = { cleanUp };
