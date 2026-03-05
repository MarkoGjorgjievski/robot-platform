/* eslint-disable no-param-reassign */
/**
 *
 * @param {ImportIO.Group[]} data
 * @returns {ImportIO.Group[]}
 */

const cleanUp = (data) => {
  const brazilianMonthNames = [
    'Janeiro',
    'Fevereiro',
    'Março',
    'Abril',
    'Maio',
    'Junho',
    'Julho',
    'Agosto',
    'Setembro',
    'Outubro',
    'Novembro',
    'Dezembro',
  ];

  const padWithZeros = number => (number < 10 ? '0' : '') + number;

  const mapping = {
    eventDateTimeText: (text, row) => {
      const dateParsingRegex = /(?<day_name>\p{L}+), (?<dayPadded>\d{2}) de (?<monthName>\p{L}+) de (?<year>\d+)( - Abertura: (?<openingTime>\d{2}:\d{2}))?( - Início: (?<startTime>\d{2}:\d{2}))?/u;
      const regexMatch = dateParsingRegex.exec(text);
      if (!regexMatch) return text;
      const {
        dayPadded,
        monthName,
        year,
        openingTime,
        startTime,
      } = regexMatch.groups;
      const month = brazilianMonthNames.indexOf(monthName);
      const day = parseInt(dayPadded, 10);

      const dateFormatted = `${year}-${padWithZeros(month + 1)}-${padWithZeros(
        day,
      )}`;
      row.eventTime = [{ text: startTime || openingTime }];
      row.eventDate = [{ text: dateFormatted }];

      return text;
    },

    venueFullAddressText: (text, row) => {
      const replacedText = text.replace(/\s/g, ' ');
      const addressRegex = /(?<venueAddress>.*)\s+-\s+(?<venueCity>[^-]+) - [^-]+$/;
      const regexMatch = addressRegex.exec(replacedText);
      if (!regexMatch) {
        return text;
      }
      const { venueAddress, venueCity } = regexMatch.groups;

      row.venueAddress = [{ text: venueAddress }];
      row.venueCity = [{ text: venueCity }];

      return text;
    },

    onSaleDateTimeText: (text, row) => {
      const date = new Date(text);
      const dateTimeFormatted = `${date.getUTCFullYear()}-${padWithZeros(
        date.getUTCMonth() + 1,
      )}-${padWithZeros(date.getUTCDate())} ${padWithZeros(
        date.getUTCHours(),
      )}:${padWithZeros(date.getUTCMinutes())}`;

      row.onSaleDateTime = [{ text: dateTimeFormatted }];
      row.isPublicPurchase = [{ text: '0' }];

      return text;
    },

    soldOutText: (text, row) => {
      row.isPublicPurchase = [{ text: '1' }];
      return text;
    },

    canBuyTickets: (text, row) => {
      row.isPublicPurchase = [{ text: '1' }];
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
