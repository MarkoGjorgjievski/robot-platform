/* eslint-disable no-param-reassign */
/**
 *
 * @param {ImportIO.Group[]} data
 * @returns {ImportIO.Group[]}
 */
const cleanUp = (data) => {
  const mapping = {
    sellingType: (text, row) => {
      if (text !== 2 && text !== 0) {
        row.isPublicPurchase = [{ text: 0 }];
      }
      row.isPublicPurchase = [{ text: 1 }];
      return text;
    },
    eventID: (text, row) => {
      // eslint-disable-next-line no-param-reassign
      row.eventURL = [{ text: `https://blueticket.meo.pt/Event/${text}` }];
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
