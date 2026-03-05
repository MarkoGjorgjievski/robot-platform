/* eslint-disable consistent-return */
/* eslint-disable no-param-reassign */
/**
 *
 * @param {ImportIO.Group[]} data
 * @returns {ImportIO.Group[]}
 */
const cleanUp = (data) => {
  const mapping = {
    eventDate: (text) => {
      const dateRegex = /\b\d{4}\/\d{1,2}\/\d{1,2}\b/;
      const match = text.match(dateRegex);
      if (match && match[0]) {
        return match[0].replace(/\//g, '-');
      }
      return null;
    },
    eventTime: (text, row) => {
      const timeRegex = /(\d{1,2}:\d{2})/;
      const match = text.match(timeRegex);
      if (match) {
        return match[0];
      }
      if (row && row.isDateTimeTBA && row.isDateTimeTBA[0]) {
        row.isDateTimeTBA[0].text = '1';
      }
      return '13:00';
    },
    onSaleDateTime: (text, row) => {
      const convertToUTC = date => new Date(date.getTime() - 1 * 3600000);
      const dateRegex = /\d+\/\d+\/\d+/;
      const timeRegex = /\d+:\d+/;
      const dateArray = text.match(dateRegex);
      const timeArray = text.match(timeRegex);
      if (dateArray && dateArray[0] && timeArray && timeArray[0]) {
        const [year, month, day] = dateArray[0].split('/');
        const [hours, minutes] = timeArray[0].split(':');
        const dateTime = new Date(year, month - 1, day, hours, minutes);
        const convertedDateTime = convertToUTC(dateTime);
        const currentDate = new Date();
        if (convertedDateTime >= currentDate && row && row.isPublicPurchase && row.isPublicPurchase[0]) {
          row.isPublicPurchase[0].text = '0';
        }
        return convertedDateTime || null;
      }
    },
    venueStateProvince: text => text.substring(0, 3),
    venueCity: text => text.substring(3, 6),
  };

  const mappingFct = (header, arr, row) => [...arr.map(({ text, ...other }) => ({ text: mapping[header](text, row), ...other }))];

  data.forEach(obj => obj.group.forEach(row => Object.keys(row).forEach((header) => {
    // eslint-disable-next-line no-param-reassign
    if (mapping[header]) row[header] = mappingFct(header, row[header], row);
  })));
  return data;
};

module.exports = { cleanUp };
