/* eslint-disable no-param-reassign */

/**
 *
 * @param {ImportIO.Group[]} data
 * @returns {ImportIO.Group[]}
 */
const cleanUp = (data) => {
  const DUTCH_MONTH_NAMES = [
    'januari',
    'februari',
    'maart',
    'april',
    'mei',
    'juni',
    'juli',
    'augustus',
    'september',
    'oktober',
    'november',
    'december',
  ];

  const createDateFromString = (matchedDate) => {
    const currentYear = new Date().getFullYear();
    const dateRegex = /(\d{1,2})\s(\w+)\s(\d{4}|(\d{1,2}[.:]\d{1,2}))/;
    const [, day, month, yearOrTime] = matchedDate.match(dateRegex);
    let year; let hours; let minutes; // change

    if (yearOrTime.includes(':') || yearOrTime.includes('.')) {
      const timeParts = yearOrTime.split(/[.:]/);
      [hours, minutes] = timeParts;
      year = currentYear;
    } else {
      year = parseInt(yearOrTime, 10);
      [hours, minutes] = [0, 0];
    }

    const monthIndex = DUTCH_MONTH_NAMES.indexOf(month);
    return new Date(year, monthIndex, day, hours, minutes);
  };

  const extractDDMMYYYY = (text) => {
    const monthNamesRegex = DUTCH_MONTH_NAMES.join('|');
    const pattern = new RegExp(
      `\\b(\\d{1,2}\\s(${monthNamesRegex})\\s\\d{4})\\b`,
    );
    const match = text.toLowerCase().match(pattern);
    if (match) {
      return createDateFromString(match[0]);
    }
    return null;
  };

  const extractDDMMhhMM = (text) => {
    const monthNamesRegex = DUTCH_MONTH_NAMES.join('|');
    const pattern = new RegExp(
      `\\b(\\d{1,2}\\s(${monthNamesRegex})\\s\\d{1,2}[.:]\\d{1,2})\\b`,
    );
    const match = text.toLowerCase().match(pattern);
    if (match) {
      return createDateFromString(match[0]);
    }
    return null;
  };

  const convertToUTC = date => new Date(date.getYear(), date.getMonth(), date.getDate(), date.getHours() - 1, date.getMinutes(), date.getSeconds());

  const parseAddress = (address) => {
    if (!address) return null;
    const regex = /^(.+?),\s*(\d{4}\s*[A-Z]{2})\s*(.+)$/;
    const match = address.match(regex);

    if (match) {
      const [, venueAddress, postalCode, venueCity] = match;

      return {
        venueAddress: venueAddress.trim(),
        postalCode: postalCode.trim(),
        venueCity: venueCity.trim(),
      };
    }

    return null;
  };

  const mapping = {
    onSaleDateTime: (text, row) => {
      const [year, month, day] = row.onSaleDate?.[0]?.text?.split('-') || [];
      const [hours, minutes] = text.split(':');

      return new Date(year, month - 1, day, hours - 1, minutes).toISOString();
    },
    preSaleDate: (text, row) => {
      const utcTime = convertToUTC(extractDDMMhhMM(text));
      row.preSaleDateTime = [{ text: utcTime.toISOString() }];
      return utcTime.toISOString();
    },
    eventDate: (text, row) => {
      const pattern2 = new RegExp(
        `\\b(\\d{1,2}\\s-\\s\\d{1,2}\\s(${DUTCH_MONTH_NAMES.join(
          '|',
        )})(?:\\s\\d{4})?)\\b`,
        'g',
      );

      let eventTimeText = '13:00';

      if (!row.eventTime) {
        row.isDateTimeTBA = [{ text: true }];
      } else {
        eventTimeText = row.eventTime[0].text;
      }

      let eventDate = extractDDMMYYYY(text);

      if (text.toLowerCase().includes('t/m')) {
        const [start, , , month, year] = text.trim().split(' ');
        eventDate = extractDDMMYYYY(`${start} ${month} ${year}`);
      }

      if (text.match(pattern2)) {
        const [start, , , month, year] = text.trim().split(' ');
        eventDate = extractDDMMYYYY(
          `${start} ${month} ${year || new Date().getFullYear()}`,
        );
      }

      const [hours, minutes] = eventTimeText.split(':');
      eventDate.setHours(+hours, +minutes);

      row.eventTime = [{ text: eventDate }];

      return eventDate;
    },
    eventName: (text, row) => {
      if (!row.isPublicPurchase) {
        row.isPublicPurchase = [{ text: false }];
      }

      return text;
    },
    venueName: (text, row) => {
      const address = parseAddress(row.venueAddress?.[0].text);

      if (!address) {
        const [, venueCity] = text.split(' — ');

        row.venueCity = [{ text: venueCity }];
      } else {
        const { venueAddress, postalCode, venueCity } = address;

        row.venueAddress = [{ text: venueAddress }];
        row.postalCode = [{ text: postalCode }];
        row.venueCity = [{ text: venueCity }];
      }

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
