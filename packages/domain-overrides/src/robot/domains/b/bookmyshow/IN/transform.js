/* eslint-disable no-param-reassign */
/**
 *
 * @param {ImportIO.Group[]} data
 * @returns {ImportIO.Group[]}
 */
//
const cleanUp = (data) => {
  const mapping = {
    eventNote: (text) => {
      if (text) {
        const eventNoteInfo = text.split(' | ');
        if (eventNoteInfo.length === 4) {
          return eventNoteInfo[2];
        }
      }
      return text;
    },
    eventRawTime: (text, row) => {
      let year; let month; let day;
      if (text === '-1' && !row.subEventsURL) {
        return '13:00';
      }
      const hour = text.slice(0, 2);
      const minute = text.slice(2, 4);
      if (row.eventRawDate) {
        year = row.eventRawDate[0].text.slice(0, 4);
        month = row.eventRawDate[0].text.slice(4, 6);
        day = row.eventRawDate[0].text.slice(6, 8);
      }
      const eventRawDate = new Date(year, Number(month) - 1, day, hour, minute);
      row.eventDateTime = [{ text: eventRawDate.toISOString() }];
      return text;
    },
    isTBA: (text, row) => {
      let isTBA = 0;
      if (row.eventRawTime?.length > 1) {
        if (row.eventRawTime?.[row.eventRawTime.length - 1].text === '-1') {
          isTBA = 1;
        }
      } else if (row.eventRawTime?.[0]?.text === '-1' || row.eventRawTime?.[0]?.text === '13:00') {
        isTBA = 1;
      }
      return isTBA;
    },
    venueAddress: (text, row) => {
      if (text) {
        const address = `${text}`;
        const venueAddressInfo = text.split(', ');
        if (venueAddressInfo) {
          row.venueCity = [{ text: venueAddressInfo[venueAddressInfo.length - 3] }];
          row.venueCountryCode = [{ text: venueAddressInfo[venueAddressInfo.length - 1].slice(0, 2).toUpperCase() }];
          const regex = /\d{6}/g;
          const findings = regex.exec(address);
          row.postalCode = venueAddressInfo[venueAddressInfo.length - 2] && venueAddressInfo[venueAddressInfo.length - 2].indexOf(' ') !== -1 ? [{ text: venueAddressInfo[venueAddressInfo.length - 2].split(' ')[1] }] : '';
          row.postalCode = findings ? [{ text: findings[0] }] : row.postalCode;
          return venueAddressInfo.slice(0, venueAddressInfo.length - 3).join(', ');
        }
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
