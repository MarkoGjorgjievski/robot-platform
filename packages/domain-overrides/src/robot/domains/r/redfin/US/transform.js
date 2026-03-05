/**
 *
 * @param {ImportIO.Group[]} data
 * @returns {ImportIO.Group[]}
 */
const cleanUp = (data) => {
  const removeEmptyRows = true;
  const mapping = {};

  const droppedFields = ['firstDepthURLPaused'];

  const mappingFct = (header, arr, row) => [...arr.map(({ text, ...other }) => ({ text: mapping[header](text, row), ...other }))];

  data.forEach((obj) => {
    obj.group.forEach(row => Object.keys(row).forEach((header) => {
      // eslint-disable-next-line no-param-reassign
      if (mapping[header]) row[header] = mappingFct(header, row[header], row);
      if (droppedFields.includes(header)) {
        // eslint-disable-next-line no-param-reassign
        row[header] = undefined;
        // eslint-disable-next-line no-param-reassign
        delete row[header];
      }
    }));
    // eslint-disable-next-line no-param-reassign
    if (removeEmptyRows) obj.group = obj.group.filter(row => Object.keys(row).length !== 0);
  });
  return data.filter(obj => (removeEmptyRows ? obj.group.length !== 0 : true));
};

module.exports = { cleanUp };
