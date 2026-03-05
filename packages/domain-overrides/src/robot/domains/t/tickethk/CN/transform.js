/* eslint-disable no-param-reassign */
/**
 *
 * @param {ImportIO.Group[]} data
 * @returns {ImportIO.Group[]}
 */
const cleanUp = (data) => {
  const MONTH_ABBREVIATIONS = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];

  const MONTHS = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'Decemeber',
  ];

  const HONK_KONG_TIMEZONE_OFFSET = 8;

  const ticketingInfoDateParsing = (text) => {
    const regex = /(?<dayStr>\d{1,2}) ((?<monthAbbreviation>\w{3})|(?<monthFull>\w{4,})) (?<yearString>\d{4}) .+? (?<hourString>\d{1,2})(:(?<minutesString>\d{2}))?(?<amPmNoon>\w{2,4})/;

    const match = regex.exec(text);
    if (match) {
      const {
        dayStr,
        monthAbbreviation,
        monthFull,
        yearString,
        hourString,
        minutesString,
        amPmNoon,
      } = match.groups;

      const day = parseInt(dayStr, 10);
      let month = 0;
      if (monthAbbreviation) {
        month = MONTH_ABBREVIATIONS.indexOf(monthAbbreviation);
      } else {
        month = MONTHS.indexOf(monthFull);
      }
      const year = parseInt(yearString, 10);
      const hour = parseInt(hourString, 10);
      const minutes = parseInt(minutesString || '0', 10);

      let effectiveHour = hour - HONK_KONG_TIMEZONE_OFFSET;
      if (amPmNoon?.toLowerCase() === 'pm') effectiveHour += 12;

      return new Date(Date.UTC(year, month, day, effectiveHour, minutes));
    }

    return undefined;
  };

  const mapping = {
    eventDateTimeText: (text, row) => {
      const regex = /(?<dayString>\d{1,2}) (?<monthAbbreviation>\w{3}) (?<yearString>\d{4})((\s|\s-\s)?(?<hourString>\d{1,2})(:(?<minutesString>\d{2}))?(?<amPm>\w{2}))?/;
      const match = regex.exec(text);
      if (match) {
        const {
          dayString,
          monthAbbreviation,
          yearString,
          hourString,
          minutesString,
          amPm,
        } = match.groups;

        const day = parseInt(dayString, 10);
        const month = MONTH_ABBREVIATIONS.indexOf(monthAbbreviation);
        const year = parseInt(yearString, 10);
        let hour = 15;
        if (hourString === undefined) {
          row.isDateTimeTBA = [{ text: '1' }];
        } else {
          hour = parseInt(hourString, 10);
        }
        const minutes = parseInt(minutesString || '0', 10);

        const date = new Date(
          Date.UTC(
            year,
            month,
            day,
            amPm?.toLowerCase() === 'pm' ? hour + 12 : hour,
            minutes,
          ),
        );

        row.eventDateTime = [{ text: date.toISOString() }];
      }

      return text;
    },

    onSaleDateTime: (text, row) => {
      const date = ticketingInfoDateParsing(text);
      row.onSaleDateTimeISO = [{ text: date?.toISOString() }];
      return date ? date.toISOString() : null;
    },
    preSaleDateTime: (text, row) => {
      const date = ticketingInfoDateParsing(text);
      row.preSaleDateTimeISO = [{ text: date?.toISOString() }];

      // if the same date is in onSaleDateTimeISO, then we don't need to add it
      const onSaleDateTimeISO = row.onSaleDateTimeISO
        ? row.onSaleDateTimeISO[0].text
        : null;
      if (onSaleDateTimeISO === date?.toISOString()) {
        return undefined;
      }
      return date ? date.toISOString() : null;
    },

    isPublicPurchase: (_, row) => {
      const onSaleDateTime = row.onSaleDateTimeISO
        ? new Date(row.onSaleDateTimeISO[0].text)
        : null;
      const preSaleDateTime = row.preSaleDateTimeISO
        ? new Date(row.preSaleDateTimeISO[0].text)
        : null;

      const currentDate = new Date();

      // presale
      if (preSaleDateTime) {
        // If date is in the past, string ‘1’ into a CSV column named “IsPublicPurchase”
        if (preSaleDateTime < currentDate) {
          return '1';
        }

        // If date is in the future, string ‘0’ into a CSV column named “IsPublicPurchase”
        if (preSaleDateTime > currentDate) {
          return '0';
        }
      }

      // onsale
      if (onSaleDateTime && preSaleDateTime === null) {
        // If no Presale info and date is in the past, string ‘1’ into a CSV column named “IsPublicPurchase”
        if (onSaleDateTime < currentDate) {
          return '1';
        }

        // If no Presale info and If date is in the future, string ‘0’ into a CSV column named “IsPublicPurchase”
        if (onSaleDateTime > currentDate) {
          return '0';
        }
      }

      return '0';
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
