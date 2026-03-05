/**
 *
 * @param {ImportIO.Group[]} data
 * @returns {ImportIO.Group[]}
 */
const cleanUp = (data) => {
  const mapping = {
    srchStatus: (text, row) => (row?.notFoundSrchStatus?.[0]?.text ? row?.notFoundSrchStatus?.[0]?.text : text),
    chkDte: (text) => {
      const [month, day, year] = text.split('/');
      return `${year}${month}${day}`;
    },
    invDte: (text) => {
      const [month, day, year] = text.split('/');
      return `${year}${month}${day}`;
    },
    dueDte: (text) => {
      const [month, day, year] = text.split('/');
      return `${year}${month}${day}`;
    },
    grossAmt: text => text.replace('$', '').replace(',', ''),
  };

  const mappingFct = (header, arr, row) => [...arr.map(({ text, ...other }) => ({ text: mapping[header](text, row), ...other }))];

  data.forEach(obj => obj.group.forEach(row => Object.keys(row).forEach((header) => {
    // eslint-disable-next-line no-param-reassign
    if (mapping[header]) row[header] = mappingFct(header, row[header], row);
  })));
  return data;
};

module.exports = { cleanUp };
