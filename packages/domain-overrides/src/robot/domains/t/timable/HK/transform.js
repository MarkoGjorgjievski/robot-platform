/* eslint-disable no-param-reassign */
/**
 *
 * @param {ImportIO.Group[]} data
 * @returns {ImportIO.Group[]}
 */

const cleanUp = (data) => {
  const monthsAbbreviated = [
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

  const HONGKONG_TIMEZONE_OFFSET_HOURS = 8;

  const DASH_CHAR_CODE = 8209;
  const NBSP_CHAR_CODE = 160;

  const padWithZeros = number => (number < 10 ? '0' : '') + number;

  const containsAMorPM = (str = '') => {
    if (str.includes('am')) {
      return 'am';
    }
    if (str.includes('pm')) {
      return 'pm';
    }
    return '';
  };

  const replaceSpecialCharacters = text => text
    .replace(new RegExp(String.fromCharCode(DASH_CHAR_CODE), 'g'), '-')
    .replace(/,/g, '')
    .replace(new RegExp(String.fromCharCode(NBSP_CHAR_CODE), 'g'), ' ');

  const parseTicketingDateTime = (text) => {
    const textReplaced = replaceSpecialCharacters(text);
    const isRange = textReplaced.includes(' - ');
    const currentYear = new Date().getFullYear();

    let dayString = null;
    let monthIndex = null;
    let hourString = null;

    if (isRange) {
      // this case: "22 May 10am - 24 May 11:59pm"
      const [firstDate] = textReplaced.split(' - ');
      const [day, month, hour] = firstDate.split(' ');

      dayString = day;
      monthIndex = monthsAbbreviated.indexOf(month);
      hourString = hour;
    } else {
      // this case "29 May (Mon) 10am onward"
      const [day, month, , hour] = textReplaced.split(' ');

      dayString = day;
      monthIndex = monthsAbbreviated.indexOf(month);
      hourString = hour;
    }

    let hour = null;
    let minutes = null;
    let isPM = null;

    const hourSplitted = hourString.split(':');
    if (hourSplitted[0] === 'noon') {
      hour = 12;
      minutes = 0;
    } else if (hourSplitted[0] === 'midnight') {
      hour = 0;
      minutes = 0;
    } else {
      hour = parseInt(hourSplitted[0], 10);
      minutes = hourSplitted[1] ? parseInt(hourSplitted[1], 10) : 0;
      isPM = containsAMorPM(hourString) === 'pm';
    }

    const date = {
      day: parseInt(dayString, 10),
      month: monthIndex,
      year: currentYear,
      hour: isPM ? hour + 12 : hour,
      minutes,
    };
    console.log(date);

    return new Date(
      date.year,
      date.month,
      date.day,
      date.hour - HONGKONG_TIMEZONE_OFFSET_HOURS,
      date.minutes - new Date().getTimezoneOffset(),
      0,
      0,
    );
  };

  const formatSaleDateTime = date => `${date.getUTCFullYear()}-${padWithZeros(
    date.getUTCMonth() + 1,
  )}-${padWithZeros(date.getUTCDate())} ${padWithZeros(
    date.getUTCHours(),
  )}:${padWithZeros(date.getUTCMinutes())}`;

  const mapping = {
    eventName: (text, row) => {
      // check if contains postponed in title
      row.titleContainsPostponed = [
        { text: text.toLowerCase().includes('postponed') },
      ];

      return text;
    },

    eventDateTimeText: (text, row) => {
      const textReplaced = replaceSpecialCharacters(text);

      let dateFormatted = '';
      let timeFormatted = '';

      const datetimeRegex = /(?<date>^[\w\s\S]*?) (?:\(.*?\))( (?<time>[\w\s\S]*?) (?:\(.*?\)))?$/gm;
      const datetimeRegexResult = datetimeRegex.exec(textReplaced);

      const dateString = datetimeRegexResult?.groups.date;
      const timeString = datetimeRegexResult?.groups.time;

      // DATE
      if (dateString) {
        const splitDateTextWithSpaces = dateString.split(/\s/g);
        let date = null;

        // when date is in ranges, then it has "-" on second position
        const isDateRange = splitDateTextWithSpaces[1] === '-';

        if (isDateRange) {
          const firstDayInRange = splitDateTextWithSpaces[0];
          const abbreviatedMonth = splitDateTextWithSpaces[3];
          const year = splitDateTextWithSpaces[4];
          const monthIndex = monthsAbbreviated.indexOf(abbreviatedMonth);

          date = {
            day: firstDayInRange,
            month: monthIndex,
            year,
          };
        } else {
          const day = splitDateTextWithSpaces[0];
          const abbreviatedMonth = splitDateTextWithSpaces[1];
          const year = splitDateTextWithSpaces[2];
          const monthIndex = monthsAbbreviated.indexOf(abbreviatedMonth);

          date = {
            day,
            month: monthIndex,
            year,
          };
        }
        dateFormatted = `${date.year}-${padWithZeros(
          date.month + 1,
        )}-${padWithZeros(date.day)}`;
      }

      // TIME
      if (timeString) {
        const splitRanges = timeString.split(' - ');
        const firstHour = splitRanges[0];
        const secondHour = splitRanges[1];
        const firstHourSplit = firstHour.split(':');
        const firstHourContainsAMorPM = containsAMorPM(firstHour);
        const secondHourContainsAMorPM = containsAMorPM(secondHour);

        let time = null;
        if (firstHour === 'noon') {
          time = {
            hour: 12,
            minutes: 0,
          };
        } else if (firstHour === 'midnight') {
          time = {
            hour: 0,
            minutes: 0,
          };
        } else if (firstHourContainsAMorPM) {
          const hour = parseInt(firstHourSplit[0], 10);
          const minutes = parseInt(firstHourSplit[1], 10);
          const isPM = firstHourContainsAMorPM === 'pm';
          time = {
            hour: isPM ? hour + 12 : hour,
            minutes: minutes || 0,
          };
        } else {
          const hour = parseInt(firstHourSplit[0], 10);
          const minutes = parseInt(firstHourSplit[1], 10);
          const isPM = secondHourContainsAMorPM === 'pm';
          time = {
            hour: isPM ? hour + 12 : hour,
            minutes: minutes || 0,
          };
        }

        timeFormatted = `${padWithZeros(time.hour)}:${padWithZeros(
          time.minutes,
        )}`;
      }

      if (timeString) {
        row.isDateTimeTBA = [{ text: '0' }];
        row.eventTime = [{ text: timeFormatted }];
      } else {
        row.isDateTimeTBA = [{ text: '1' }];
        row.eventTime = [{ text: '13:00' }];
      }
      row.eventDate = [{ text: dateFormatted }];

      return text;
    },

    firstTicketingPublicSaleDateTimeText: (text, row) => {
      const date = parseTicketingDateTime(text);

      const dateIsInThePast = date < new Date();
      const dateIsInTheFuture = date > new Date();

      row.firstTicketingPublicSaleDateParsed = [{ text: date.toISOString() }];

      row.onSaleDateTime = [{ text: formatSaleDateTime(date) }];

      if (dateIsInThePast && row.titleContainsPostponed[0]?.text === false) {
        row.isPublicPurchase = [{ text: '1' }];
      }

      if (dateIsInTheFuture) {
        row.isPublicPurchase = [{ text: '0' }];
      }

      return text;
    },

    firstTicketingDateTimeText: (text, row) => {
      const date = parseTicketingDateTime(text);
      const dateIsInThePast = date < new Date();

      const firstTicketingPublicSaleDateParsed = row.firstTicketingPublicSaleDateParsed
        ? row.firstTicketingPublicSaleDateParsed[0]?.text
        : undefined;

      const onSaleDateTimeIsInTheFuture = new Date(firstTicketingPublicSaleDateParsed) > new Date();

      const isEarlierThanFirstTicketingPublicSaleDate = date < new Date(firstTicketingPublicSaleDateParsed);

      //  If an earlier date is available and not listed as “Public Sale” string ‘I’ into a CSV column named “PreSaleDateTime”, in format “YYYY-MM-DD hh:MM” converting from local time to UTC.

      if (
        isEarlierThanFirstTicketingPublicSaleDate
        || !firstTicketingPublicSaleDateParsed
      ) {
        row.preSaleDateTime = [{ text: formatSaleDateTime(date) }];
      }

      // If date/time is in the past but OnSaleDateTime date is in the future (and exists) string ‘1’ into a CSV column named “IsPublicPurchase”

      if (
        dateIsInThePast
        && firstTicketingPublicSaleDateParsed
        && onSaleDateTimeIsInTheFuture
        && row.titleContainsPostponed[0]?.text === false
      ) {
        row.isPublicPurchase = [{ text: '1' }];
      }

      // If date/time is in the past but OnSaleDateTime date not exists string ‘1’ into a CSV column named “IsPublicPurchase”

      if (
        dateIsInThePast
        && !firstTicketingPublicSaleDateParsed
        && row.titleContainsPostponed[0]?.text === false
      ) {
        row.isPublicPurchase = [{ text: '1' }];
      }

      // If date/time for both are in the future string ‘0’ into a CSV column named “IsPublicPurchase”

      // (do nothing)

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
