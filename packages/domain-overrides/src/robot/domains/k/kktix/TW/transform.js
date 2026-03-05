/* eslint-disable no-param-reassign */
/**
 *
 * @param {ImportIO.Group[]} data
 * @returns {ImportIO.Group[]}
 */
//
const cleanUp = (data) => {
  const mapping = {
    venueName: text => text.split(' / ')[0],
    venueAddress: text => text.split(' / ')[1],
    venueCity: (text) => {
      const venueAddress = text.split(' / ')[1];

      const regex = /^\d*(.{2})/;

      return venueAddress?.match(regex)?.[1];
    },
    addressData: (text, row) => {
      const venueName = text.split(' / ')[0];
      const venueAddress = text.split(' / ')[1];

      // first two signs of address are city - in Chineese
      const venueCity = venueAddress?.match(/^\d*\s*(.{2})/)?.[1];

      // if first two letter are not signs, but rather latin letters , then do not fill that field
      const containsTwoLatinLettersRegex = /\w{2}/;
      const venueCityIsLatin = venueCity?.match(containsTwoLatinLettersRegex);

      if (!venueCityIsLatin) {
        row.venueCity = [{ text: venueCity }];
      }

      row.venueName = [{ text: venueName }];
      row.venueAddress = [{ text: venueAddress }];

      return null;
    },
    eventDate: text => text.match(/\d{4}\/\d{2}\/\d{2}/)?.[0],
    eventTime: text => text.match(/\d{1,2}:\d{2}/)?.[0],
    onSaleDateTime: text => text.match(/\d{4}\/\d{2}\/\d{2}\(\w+\) (\d{2}:\d{2})\(\+\d{4}\)/)?.[0],
    isPublicPurchase: text => new Date(text.replace(/\([^)]+\)/g, '')) > new Date(),
    eventUniqueId: text => text.split('/').slice(-3, -2)[0],
    eventURL: text => text.replace('/registrations/new', ''),
    firstOnSaleDateTime: (text, row) => {
      const regex = /(?<yearString>\d{4})\/(?<monthString>\d{2})\/(?<dayString>\d{2})\s*(?<hourString>\d{2}):(?<minutesString>\d{2})/;

      const match = regex.exec(text);

      if (!match) return null;
      const {
        yearString, monthString, dayString, hourString, minutesString,
      } = match.groups;

      const year = parseInt(yearString, 10);
      const month = parseInt(monthString, 10) - 1;
      const day = parseInt(dayString, 10);
      const hour = parseInt(hourString, 10) - 8;
      const minutes = parseInt(minutesString, 10);

      const date = new Date(Date.UTC(year, month, day, hour, minutes));

      row.onSaleDateTime = [{ text: date.toISOString() }];
      return date.toISOString();
    },
  };

  const mappingFct = (header, arr, row) => [
    ...arr.map(({ text, ...other }) => ({
      text: mapping[header](text, row),
      ...other,
    })),
  ];

  data.forEach(obj => obj.group.forEach(row => Object.keys(row).forEach((header) => {
    // eslint-disable-next-line no-param-reassign
    if (mapping[header]) row[header] = mappingFct(header, row[header], row);
  })));
  return data;
};

module.exports = { cleanUp };
