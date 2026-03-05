/**
 *
 * @param {ImportIO.Group[]} data
 * @returns {ImportIO.Group[]}
 */
const cleanUp = (data) => {
  const checkDayDigitCount = text => (text.length < 2 ? `0${text}` : text);
  const mapping = {
    invDte: (text) => {
      const [month, day, year] = text.split('/');
      const checkedDay = checkDayDigitCount(day);
      const checkedMonth = checkDayDigitCount(month);
      return `${year}${checkedMonth}${checkedDay}`;
    },
    dueDte: (text) => {
      const [month, day, year] = text.split('/');
      const checkedDay = checkDayDigitCount(day);
      const checkedMonth = checkDayDigitCount(month);
      return `${year}${checkedMonth}${checkedDay}`;
    },
    chkDte: (text) => {
      const [month, day, year] = text.split('/');
      const checkedDay = checkDayDigitCount(day);
      const checkedMonth = checkDayDigitCount(month);
      return `${year}${checkedMonth}${checkedDay}`;
    },
    grossAmt: text => text.replace('$', '').replace(',', ''),
    netAmt: text => text.replace('$', '').replace(',', ''),
    discAmt: text => text.replace('$', '').replace(',', ''),
    chkAmt: text => text.replace('$', '').replace(',', ''),
  };

  const mappingFct = (header, arr, row) => [...arr.map(({ text, ...other }) => ({ text: mapping[header](text, row), ...other }))];

  data.forEach(obj => obj.group.forEach(row => Object.keys(row).forEach((header) => {
    // eslint-disable-next-line no-param-reassign
    if (mapping[header]) row[header] = mappingFct(header, row[header], row);
  })));
  return data;
};

module.exports = { cleanUp };
