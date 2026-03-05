/* eslint-disable no-param-reassign */

/**
 *
 * @param {ImportIO.Group[]} data
 * @returns {ImportIO.Group[]}
 */
const cleanUp = (data) => {
  const MEXICAN_MONTH_NAMES = [
    'enero',
    'febrero',
    'marzo',
    'abril',
    'mayo',
    'junio',
    'julio',
    'agosto',
    'septiembre',
    'octubre',
    'noviembre',
    'diciembre',
  ];

  const MEXICAN_MONTH_ABBREVIATIONS = MEXICAN_MONTH_NAMES.map(name => name.slice(0, 3));

  const formatDateTime = (date) => {
    const time = date.getTime();
    if (Number.isNaN(time)) return null;
    return date.toISOString();
  };

  const mapping = {
    eventDate: (text) => {
      const regex = /(?<dayString>\d{1,2}) (?<monthString>\w+) (?<yearString>\d{4})/;
      const match = regex.exec(text);
      if (!match) return text;

      const { dayString, monthString, yearString } = match.groups;
      const monthIdxFullName = MEXICAN_MONTH_NAMES.indexOf(monthString);
      const monthIdxAbbreviation = MEXICAN_MONTH_ABBREVIATIONS.indexOf(monthString);

      const monthIdx = monthIdxFullName !== -1 ? monthIdxFullName : monthIdxAbbreviation;
      const year = parseInt(yearString, 10);
      const day = parseInt(dayString, 10);

      const date = new Date(Date.UTC(year, monthIdx, day));
      return formatDateTime(date);
    },
    eventTime: (text, row) => {
      let hours = null;
      let minutes = null;
      let isTBA = null;

      const regex = /(?<hourString>\d+):(?<minutesString>\d+)/;
      const match = regex.exec(text);

      if (text == null || !match) {
        hours = '15';
        minutes = '0';
        isTBA = '1';
      } else {
        const { hourString, minutesString } = match.groups;
        hours = hourString;
        minutes = minutesString;
        isTBA = '0';
      }

      const date = new Date(row.eventDate?.[0].text);
      date.setUTCHours(parseInt(hours, 10));
      date.setUTCMinutes(parseInt(minutes, 10));

      row.isTBA = [{ text: isTBA }];
      row.eventDateTime = [{ text: formatDateTime(date) }];

      return formatDateTime(date);
    },
    venue_full_address: (text, row) => {
      // Paseo de Las Jacarandas 224 B, Boca del Río, Veracruz 94294 México
      const regex = /(?<address>.*), (?<city>.+) (?<postalCode>\d+) .*/;
      const match = regex.exec(text);
      if (!match) return text;

      const { address, city, postalCode } = match.groups;

      row.venueAddress = [{ text: address }];
      row.venueCity = [{ text: city }];
      row.postalCode = [{ text: postalCode }];

      return text;
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
