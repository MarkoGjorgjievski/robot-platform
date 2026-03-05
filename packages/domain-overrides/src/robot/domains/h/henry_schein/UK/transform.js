/* eslint-disable no-param-reassign */
/**
 *
 * @param {ImportIO.Group[]} data
 * @returns {ImportIO.Group[]}
 */

const cleanUp = (data) => {
  const getVals = (row, name) => (row[name]?.map(ob => ob.text) ?? []);
  const mapping = {
    specialPrice: (text, row) => {
      if (!row.price) {
        row.price = [{ text }];
        return null;
      }
      return text;
    },
    uom: (text, row) => {
      const summed = [...getVals(row, 'uomWithUnits'), ...getVals(row, 'uomSetsAndKits'), ...getVals(row, 'uomSetOf')];
      if (!summed.length) return null;
      return summed.map(word => word.trim()).join(' ');
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
