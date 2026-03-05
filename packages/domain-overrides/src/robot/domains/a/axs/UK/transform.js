/**
 *
 * @param {ImportIO.Group[]} data
 * @returns {ImportIO.Group[]}
 */
const cleanUp = (data) => {
  const mapping = {
    eventDate: (text) => {
      const [day, monthName, year] = text.split(' ');
      const month = new Date(Date.parse(`${monthName} 1, 2000`)).getMonth();
      return new Date(year, month, day);
    },
    eventTime: (text) => {
      const pattern = /^(0[0-9]|1[0-9]|2[0-3]):[0-5][0-9]$/;
      if (pattern.test(text)) return text;
      return new Date(text);
    },
    onSaleDate: text => new Date(text),
    postalCode: text => text.split(' ').slice(-2).join(' '),
  };

  const mappingFct = (header, arr) => [...arr.map(({ text, ...other }) => ({ text: mapping[header](text), ...other }))];

  data.forEach(obj => obj.group.forEach(row => Object.keys(row).forEach((header) => {
    // eslint-disable-next-line no-param-reassign
    if (mapping[header]) row[header] = mappingFct(header, row[header]);
  })));
  return data;
};

module.exports = { cleanUp };
