/**
 *
 * @param {ImportIO.Group[]} data
 * @returns {ImportIO.Group[]}
 */

/* eslint-disable no-param-reassign */
const cleanUp = (data) => {
  // const adjustTimezone = (timestamp) => {
  //   if (timestamp.endsWith('+02:00')) {
  //     let adjustedTimestamp = timestamp.replace(/\+02:00$/, '+01:00');
  //     return adjustedTimestamp;
  //   };
  //   return timestamp;
  // }

  const mapping = {
    isPublicPurchase: text => !!text.toLowerCase().includes('tickets sichern ab'),
    eventDate: (text, row) => {
      const date = new Date(text);

      if (text.endsWith('+02:00')) {
        date.setHours(date.getHours() + 2);
      }

      if (text.endsWith('+01:00')) {
        date.setHours(date.getHours() + 1);
      }

      if (!date.getHours() && !date.getMinutes()) {
        row.isDateTimeTBA = [{ text: true }];
        date.setHours(13);
      }

      row.eventTime = [{ text: date }];

      return date;
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
