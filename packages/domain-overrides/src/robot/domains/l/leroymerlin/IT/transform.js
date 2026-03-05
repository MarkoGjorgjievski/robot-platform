/* eslint-disable no-param-reassign */
/**
 *
 * @param {ImportIO.Group[]} data
 * @returns {ImportIO.Group[]}
 */
const cleanUp = (data) => {
  const labeledDimensionRegex = /(Dimensioni|Misure)[^\d]*\s*([\d.,]+)(\s*x\s*([\d,.]+))?(\s*x\s*([\d,.]+))?/;
  const unlabeledDimensionRegex = /(\d+([,.]\d+)?)(\s*x\s*(\d+([,.]\d+)?)(\s*x\s*(\d+([,.]\d+)?))?)?/;

  const checkBackups = row => row.length_backup || row.height_backup || row.depth_backup || row.width_backup;

  const getBackup = (text, backup) => {
    if (text === 'empty') {
      return backup?.[0]?.text ?? null;
    }
    return text;
  };

  const resolveDimension = (text, row, index) => {
    if (text === 'empty') {
      if (checkBackups(row)) return null;
      const labeledMatch = row.description?.[0]?.text?.match(labeledDimensionRegex);
      // 2 4 6
      if (labeledMatch) return labeledMatch?.[index * 2]?.replace(/[,.]$/, '') ?? null;
      const unlabeledMatch = row.product_title?.[0]?.text?.match(unlabeledDimensionRegex);
      // 1 4 7
      return unlabeledMatch?.[3 * index - 2]?.replace(/[,.]$/, '') ?? null;
    }
    return text;
  };

  const mapping = {
    original_price: text => text.replace(',', '.'),
    offer_price: text => text.replace(',', '.'),
    length: (text, row) => getBackup(text, row.length_backup) || resolveDimension(text, row, 1),
    width: (text, row) => getBackup(text, row.width_backup) || resolveDimension(text, row, 2),
    height: (text, row) => getBackup(text, row.height_backup) || resolveDimension(text, row, 3),
    depth: (text, row) => getBackup(text, row.depth_backup),
  };

  const mappingFct = (header, arr, row) => [...arr.map(({ text, ...other }) => ({ text: mapping[header](text, row), ...other }))];

  data.forEach(obj => obj.group.forEach(row => Object.keys(row).forEach((header) => {
    // eslint-disable-next-line no-param-reassign
    if (mapping[header]) row[header] = mappingFct(header, row[header], row);
  })));
  return data;
};

module.exports = { cleanUp };
