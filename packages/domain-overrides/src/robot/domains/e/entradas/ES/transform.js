/**
 *
 * @param {ImportIO.Group[]} data
 * @returns {ImportIO.Group[]}
 */
const cleanUp = (data) => {
  const mapping = {
    isDateTimeTBA: text => (text.match(/(\d{2}:\d{2}:\d{2})/)?.[1] ? 'false' : 'true'),
    eventDate: text => text.match(/(\d{4}-\d{2}-\d{2})/)?.[1],
    eventTime: (text, row) => {
      const time = text.match(/(\d{2}:\d{2}:\d{2})/)?.[1];
      if (row.timeCheck?.[0].text.split('|').length === 1) {
        // eslint-disable-next-line no-param-reassign
        row.isDateTimeTBA = [{ text: 'true' }];
        return `${row.eventDate[0].text} 13:00:00`;
      }
      if (row.eventDate) {
        return `${row.eventDate[0].text} ${time}`;
      }
      return time;
    },
    venueAddress: (text, row) => {
      if (text === 'null') {
        return row.venueAddressBackup?.[0]?.text ?? null;
      }
      return text.split('\n')[0];
    },
    isPublicPurchase: (text, row) => {
      if (row.publicPurchaseOverride?.[0]?.text === 'true') {
        return '0';
      }
      return text;
    },
    venueAmenities: (_, row) => row.venueAmenities.map(({ text }) => text).join(','),
  };

  const mappingFct = (header, arr, row) => [...arr.map(({ text, ...other }) => ({ text: mapping[header](text, row), ...other }))];

  data.forEach(obj => obj.group.forEach(row => Object.keys(row).forEach((header) => {
    // eslint-disable-next-line no-param-reassign
    if (mapping[header]) row[header] = mappingFct(header, row[header], row);
  })));
  return data;
};

module.exports = { cleanUp };
