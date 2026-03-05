/* eslint-disable no-param-reassign */
/**
 *
 * @param {ImportIO.Group[]} data
 * @returns {ImportIO.Group[]}
 */
const cleanUp = (data) => {
  const formatDate = (text) => {
    const [month, day, year] = text.split('/');
    return `20${year}${month.padStart(2, '0')}${day.padStart(2, '0')}`;
  };
  const mapping = {
    chkDte: formatDate,
    dueDte: formatDate,
    invDte: formatDate,
    grossAmt: text => text.replace(',', ''),
    discAmt: text => text.replace(',', ''),
    chkAmt: text => text.replace(',', ''),
  };

  const mappingFct = (header, arr, row) => arr.map(({ text, ...other }) => ({
    text: mapping[header](text, row),
    ...other,
  }));

  data.forEach(obj => obj.group.forEach(row => Object.keys(row).forEach((header) => {
    // eslint-disable-next-line no-param-reassign
    if (mapping[header]) row[header] = mappingFct(header, row[header], row);
  })));

  return data;
};

module.exports = { cleanUp };
