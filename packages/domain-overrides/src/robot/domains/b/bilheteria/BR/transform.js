/**
 *
 * @param {ImportIO.Group[]} data
 * @returns {ImportIO.Group[]}
 */
//
const cleanUp = (data) => {
  const mapping = {
    eventDate: (text, row) => `${text} / ${row.eventYear[0].text}`,
    venueAddress: (text, row) => {
      const result = text.match(/(\d+-\d+)$/);
      if (result) {
        // eslint-disable-next-line no-param-reassign
        row.postalCode = [{ text: result[0] }];
        return text.split(result[0])[0]?.trim();
      }
      // eslint-disable-next-line no-param-reassign
      row.postalCode = [{ text: '' }];
      return text;
    },
    eventID: text => text.split('/').pop(),
    // eslint-disable-next-line eqeqeq
    isPublicPurchase: text => (text == 0 ? 1 : 0),
    uniqueKey: (text, row) => {
      // eslint-disable-next-line no-param-reassign
      row.eventURL = [{ text: `https://www.bilheteria.com.br/evento/${text}` }];
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
