/* eslint-disable no-param-reassign */
/**
 *
 * @param {ImportIO.Group[]} data
 * @returns {ImportIO.Group[]}
 */
const cleanUp = (data) => {
  const timeFormatting = (time) => {
    const [twelveHours, min, pmOrAm] = time?.trim()?.split(/[.:\s]/g) || [0, 0, ''];
    const hours = parseInt(pmOrAm === 'AM' ? twelveHours : parseInt(twelveHours, 10) + 12, 10);
    return { hours, min: parseInt(min, 10) };
  };
  const saleDateExtraction = (text) => {
    const regex = /\b(\b[A-Z][a-z]+day\b) (\d{1,2}) ([A-Za-z]+) at (\d{1,2})([ap]m)\b/;
    const match = text.match(regex);

    if (match) {
      const date = match[2];
      const month = match[3];
      const formattedDate = new Date(`${month} ${parseInt(date, 10)}, ${new Date().getFullYear()}`).toISOString().split('T')[0];
      return `${formattedDate}`;
    }
    return text.toLowerCase();
  };
  const mapping = {
    eventURL: text => (text.includes('.com') ? text : `https://booking.theticketfactory.com${text}`),
    isPublicPurchase: text => (['0', 0, '1', 1].includes(text) ? text : '0'),
    venueCity: text => (text.includes(',') ? text.split(',').slice(-1)?.[0]?.trim() : ''),
    eventTimeJSON: (text, row) => {
      const { eventDayJSON, eventMonthJSON, eventYearJSON } = row;
      const [year, month, day] = [eventYearJSON, eventMonthJSON, eventDayJSON].map(val => val?.[0]?.text);
      const { hours, min } = timeFormatting(text);
      const formattedDate = new Date(parseInt(year.trim(), 10), parseInt(month.trim(), 10) - 1, parseInt(day.trim(), 10), hours, min);
      row.eventDateTime = [{ text: formattedDate }];
    },
    eventNameTopLevel: (text, row) => {
      if (row.eventName?.length > 0) return;
      row.eventName = [{ text }];
    },
    eventDateTimeDummy: (text, row) => {
      if (row.eventDateTime?.length > 0 || row.eventTimeJSON?.length > 0) return;
      const [dateRaw, timeRaw] = [row.eventDateTopLevel, row.eventTimeTopLevel].map(val => val?.[0]?.text);
      const { hours, min } = timeFormatting(timeRaw?.split(/ [-–] /g)?.[1] || timeRaw);
      const dateString = dateRaw?.split(/ [-–] /g)?.[0];
      const dateNoTime = new Date(Number.isNaN(Date.parse(dateString)) ? `${dateString?.trim()} 2023` : dateString);
      dateNoTime.setHours(hours);
      dateNoTime.setMinutes(min);
      row.eventDateTime = [{ text: new Date(dateNoTime) }];
    },
    eventNameJQ: (text, row) => {
      row.eventName = [{ ...row.eventNameJQ[0] }];
      return text;
    },
    venueCityJQ: (text, row) => {
      row.venueCity = [{ ...row.venueCityJQ[0] }];
      return text;
    },
    postalCodeReg: (text, row) => {
      const regex = /[A-Z]{1,2}\d[A-Z\d]? \d[A-Z]{2}/;
      const match = text.match(regex);
      const postalCode = match[0];
      row.postalCode = postalCode;
    },
    postalCodeJQ: (text, row) => {
      row.postalCode = [{ ...row.postalCodeJQ[0] }];
      return text;
    },
    onSaleDate: saleDateExtraction,
    preSaleDate: saleDateExtraction,
    venueNameJQ: (text, row) => {
      row.venueName = [{ ...row.venueNameJQ[0] }];
      return text;
    },
  };

  const mappingFct = (header, arr, row) => arr.map(({ text, ...other }) => ({ text: mapping[header](text, row), ...other }));

  data.forEach(obj => obj.group.forEach(row => Object.keys(row).forEach((header) => {
    // eslint-disable-next-line no-param-reassign
    if (mapping[header]) row[header] = mappingFct(header, row[header], row);
  })));

  return data;
};

module.exports = { cleanUp };
