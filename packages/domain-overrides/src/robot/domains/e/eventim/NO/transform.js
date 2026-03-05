/**
 *
 * @param {ImportIO.Group[]} data
 * @returns {ImportIO.Group[]}
 */
const cleanUp = (data) => {
  const mapping = {
    eventTime: text => text.match(/(\d{2}:\d{2}:\d{2})/)?.[1],
    isDateTimeTBA: text => (text.match(/(\d{2}:\d{2}:\d{2})/)?.[1] ? 'false' : 'true'),
    eventDate: text => text.match(/(\d{4}-\d{2}-\d{2})/)?.[1],
    venueAddress: (text, row) => {
      if (text === 'null') {
        return row.venueAddressBackup?.[0]?.text ?? null;
      }
      return text.split('\n')[0];
    },
    isPublicPurchase: (text, row) => {
      if (row.publicPurchaseOverride?.[0]?.text === 'true') {
        return '1';
      }
      return text;
    },
    venueAmenities: (_, row) => row.venueAmenities.map(({ text }) => text).join(','),
    onSaleDate: (text) => {
      if (!text) return '';
      // Regular expression patterns to match the date and time
      const datePattern = /(\d{2}\/\d{2}\/\d{4})/;
      const timePattern = /(\d{2}:\d{2})/;

      // Extract the date using match() function and regex pattern
      const dateMatch = text.match(datePattern);
      const timeMatch = text.match(timePattern);

      if (dateMatch && timeMatch) {
        const extractedDate = dateMatch[0]; // The first capturing group contains the date
        const extractedTime = timeMatch[0]; // The first capturing group contains the time
        return `${extractedDate} ${extractedTime}`;
      }
      console.log('Date or time not found in the input string.');
      return '';
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
