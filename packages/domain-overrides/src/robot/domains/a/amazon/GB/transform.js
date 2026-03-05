/* eslint-disable no-param-reassign */
/**
 *
 * @param {ImportIO.Group[]} data
 * @returns {ImportIO.Group[]}
 */
const cleanUp = (data) => {
  const mapping = {
    resellerAggregateRating: (text, row) => {
      const starRange = 100 / 5;
      if (!row || !row.resellerFeedbackPercent || !row.resellerFeedbackPercent[0]) return text;
      return row.resellerFeedbackPercent[0].text / starRange;
    },
    price: text => (typeof text === 'string' ? text.replace(',', '') : text),
    brandText: text => (typeof text === 'string' ? text.replace('Visit the', '') : text),
    redirectedASIN: (text, row) => {
      if (text !== 'dummy') return text;
      if (row.redirectedASINBackup[0].text && row.redirectedASINBackup[0].text !== 'dummy') return row.redirectedASINBackup?.[0]?.text;
      return row.productASIN && row.productASIN?.[0]?.text;
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
