/**
 *
 * @param {ImportIO.Group[]} data
 * @returns {ImportIO.Group[]}
 */
const cleanUp = (data) => {
  const mapping = {
    time: (text, row) => {
      const stringDate = row?.date?.[0]?.text.replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3');
      const stringTime = text.replace(/(\d{2})(\d{2})/, '$1:$2');

      // eslint-disable-next-line no-param-reassign
      // row.eventDateTime = [{ text: new Date(`${stringDate}T${stringTime}:00.000+09:00`).toISOString() }];
      // eslint-disable-next-line no-param-reassign
      row.eventDateTime = [{ text: new Date(`${stringDate}T${stringTime}`).toISOString() }];
      return text;
    },
    isTBA: (text, row) => {
      if (!row?.time) return '1';
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
