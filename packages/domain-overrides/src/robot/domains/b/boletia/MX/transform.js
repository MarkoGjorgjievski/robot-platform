/* eslint-disable no-param-reassign */

/**
 *
 * @param {ImportIO.Group[]} data
 * @returns {ImportIO.Group[]}
 */
const cleanUp = (data) => {
  const mapping = {
    eventDateTimeISO: (text, row) => {
      const date = new Date(text);

      const year = date.getUTCFullYear();
      const month = String(date.getUTCMonth() + 1).padStart(2, '0');
      const day = String(date.getUTCDate()).padStart(2, '0');
      const hours = String(date.getUTCHours()).padStart(2, '0');
      const minutes = String(date.getUTCMinutes()).padStart(2, '0');

      const formattedDate = `${year}-${month}-${day} ${hours}:${minutes}`;

      row.eventDateTime = [{ text: formattedDate }];

      return text;
    },
    isPublicPurchase: (text) => {
      if (text === 'Buy tickets') return '1';
      return '0';
    },
    addressText: (text, row) => {
      // PX7R+J4 Chihuahua, Chih., México
      const openLocationCodeRegex = /^(?<openLocationCode>[A-Z0-9+]+) (?<city>.+?), (?<state>.+?), (?<countryName>.+)/;

      // EXAMPLE INPUT: Epigmenio González 54, Mexicaltzingo, 44180 Guadalajara, Jal., Mexico
      const regularAddressRegex = /^(?<streetAddress>.+), (?<postalCode>\d{5}) (?<city>.+?),/;

      const openLocationCodeMatch = openLocationCodeRegex.exec(text);
      const regularAddressMatch = regularAddressRegex.exec(text);

      if (openLocationCodeMatch) {
        const { openLocationCode, city } = openLocationCodeMatch.groups;

        row.venueAddress = [{ text: openLocationCode }];

        row.venueCity = [{ text: city }];

        row.postalCode = [{ text: '' }];
      }

      if (regularAddressMatch) {
        const { streetAddress, postalCode, city } = regularAddressMatch.groups;

        row.venueAddress = [{ text: streetAddress }];

        row.venueCity = [{ text: city }];

        row.postalCode = [{ text: postalCode }];
      }

      return text;
    },
  };

  const mappingFct = (header, arr, row) => arr.map(({ text, ...other }) => ({
    text: mapping[header](text, row),
    ...other,
  }));

  data.forEach(obj => obj.group.forEach(row => Object.keys(row).forEach((header) => {
    // eslint-disable-next-line no-param-reassign
    if (mapping[header]) row[header] = mappingFct(header, row[header], row);
  })));

  return data;
};

module.exports = { cleanUp };
