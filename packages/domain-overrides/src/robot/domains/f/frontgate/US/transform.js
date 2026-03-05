/* eslint-disable no-param-reassign */

/**
 *
 * @param {ImportIO.Group[]} data
 * @returns {ImportIO.Group[]}
 */

const cleanUp = (data) => {
  const defaultAddress = (text, row, def) => {
    if (text === 'empty') {
      return (row.venueName?.[0]?.text === 'Glen Helen Regional Park') ? def : null;
    }
    return text;
  };
  const timeRegex = /(\d{2}:\d{2})/;
  const USTimeZones = {
    HST: '-10:00',
    AKST: '-09:00',
    AKDT: '-08:00',
    PST: '-08:00',
    PDT: '-07:00',
    MST: '-07:00',
    MDT: '-06:00',
    CST: '-06:00',
    CDT: '-05:00',
    EST: '-05:00',
    EDT: '-04:00',
    PT: '-08:00',
    MT: '-07:00',
    CT: '-06:00',
    ET: '-05:00',
  };

  const mapping = {
    onSaleDateTime: (text, row) => {
      const match = text.match(/([\d]{1,2})\/([\d]{1,2})\/([\d]{4}) ([\d]{1,2}:[\d]{1,2}[AP]M) ([A-Z]+)/);
      // convert AM PM to 24h format
      let time24h = match[4];
      if (time24h.includes('PM') && time24h.split(':')[0] !== '12') {
        let [hours, minutes] = time24h.split(':');
        if (hours.length === 1) hours = `0${hours}`;
        if (minutes.length === 1) minutes = `0${minutes}`;
        [time24h] = timeRegex.exec(`${parseInt(hours, 10) + 12}:${minutes}`);
        console.log('time24h', time24h);
      } else {
        let [hours, minutes] = time24h.split(':');
        if (hours.length === 1) hours = `0${hours}`;
        if (minutes.length === 1) minutes = `0${minutes}`;
        [time24h] = timeRegex.exec(`${hours}:${minutes}`);
        console.log('time24h', time24h);
      }
      let month = match[1];
      if (match[1].length === 1) month = `0${match[1]}`;
      let day = match[2];
      if (match[2].length === 1) day = `0${match[2]}`;
      const formattedDate = `${match[3]}-${month}-${day}T${time24h}:00.000${USTimeZones[match[5]]}`;
      console.log('formattedDate', formattedDate);
      row.onSaleDate = [{ text: `${match[3]}-${month}-${day}` }];
      return new Date(Date.parse(formattedDate)).toISOString();
    },
    venueName: text => text.replace(/^at\s/, ''),
    venueAddress: (text, row) => defaultAddress(text, row, 'Glen Helen Regional Park'),
    venueCity: (text, row) => defaultAddress(text, row, 'San Bernardino'),
    venueStateProvince: (text, row) => defaultAddress(text, row, 'CA'),
    postalCode: (text, row) => defaultAddress(text, row, '92407'),
    eventName: (text, row) => `${text} : ${row.ticketName?.[0]?.text || ''}`,
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
