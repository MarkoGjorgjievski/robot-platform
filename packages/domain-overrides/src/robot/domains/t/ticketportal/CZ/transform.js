/* eslint-disable no-param-reassign */
/**
 *
 * @param {ImportIO.Group[]} data
 * @returns {ImportIO.Group[]}
 */
//
const cleanUp = (data) => {
  const mapping = {
    eventDateTime: (text, row) => {
      if (row.IsDateTimeTBA?.[0].text === '0') {
        const dateValues = text.split('T')[0].split('-').map(num => `0${num}`.slice(-2));
        return `20${dateValues[0]}-${dateValues[1]}-${dateValues[2]} 13:00`;
      }

      return text;
    },
    isDateTimeTBA: (text) => {
      if (text === '0') {
        return 1;
      }
      return 0;
    },
    venueName: text => text.split(',')[0],
    venueAddress: text => text.replace(' Navigovat', '').replace(' Navigate', ''),
    isPublicPurchase: () => true,
    purchaseInfo: (text, row) => {
      if (row.isPublicPurchase) return;

      if (text.includes('vyprodáno')) {
        row.isPublicPurchase = [{ text: 1 }];
        return;
      }

      row.isPublicPurchase = [{ text: 0 }];
    },
    venueIdSecondTime: (text, row) => text === row.venueId?.[0].text,
  };

  const mappingFct = (header, arr, row) => [...arr.map(({ text, ...other }) => ({ text: mapping[header](text, row), ...other }))];

  let isSinglePage = false;
  data.forEach((obj) => {
    obj.group.forEach(row => Object.keys(row).forEach((header) => {
      if (header === 'isPublicPurchase') isSinglePage = true;
      // eslint-disable-next-line no-param-reassign
      if (mapping[header]) row[header] = mappingFct(header, row[header], row);
    }));
    if (isSinglePage) obj.group = obj.group.filter(row => Object.keys(row).find(header => header === 'venueIdSecondTime' && row[header][0].text === true));
  });
  return data;
};

module.exports = { cleanUp };
