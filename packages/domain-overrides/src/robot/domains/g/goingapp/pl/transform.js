/* eslint-disable prefer-destructuring */
/* eslint-disable no-param-reassign
*/
/**
 *
 * @param {ImportIO.Group[]} data
 * @returns {ImportIO.Group[]}
 */

const cleanUp = (data) => {
  const mapping = {
    // eventTimeDescription: (text, row) => {
    //   const time = text.match(/(?<=g.)(\d{2}.\d{2})/)?.[0];
    //   if (time !== undefined) {
    //     row.eventTime = [{ text: `${time}` }];
    //   }
    //   return time;
    // },
    eventTimeCheck: (text, row) => {
      text = text.match(/(\d{1,2}.\d{2})/)?.[0];
      if (text === undefined) {
        row.isDateTimeTBA = [{ text: true }];
        row.eventTime = [{ text: '13:00' }];
      }
      return text;
    },
    isDateTimeTBA: (text, row) => {
      if (!row.eventTimeCheck?.[0]?.text) {
        row.eventTime = [{ text: '13:00' }];
        text = true;
      }
      return text;
    },
    eventDateTimeTemp: (text, row) => {
      const date = text.match(/^(.+)(?=T)/)?.[0];
      const time = text.match(/(?<=T)(.+)(?=\+)/)?.[0];

      row.eventDate = [{ text: `${date}` }];
      if (row.isDateTimeTBA?.[0]?.text === 'false') row.eventTime = [{ text: `${time}+01:00` }];

      return text;
    },
    eventName: (text, row) => {
      let city = row.venueCity?.[0]?.text;
      text = text.replace(city, '');
      city = city.toUpperCase();
      text = text.replace(city, '');
      city = city.toLowerCase();
      text = text.replace(city, '');
      text = text.replace(/\|/g, '');
      return text;
    },
    // eventDate: (text) => {
    //   const months = {
    //     stycznia: '01',
    //     lutego: '02',
    //     marca: '03',
    //     kwietnia: '04',
    //     maja: '05',
    //     czerwca: '06',
    //     lipca: '07',
    //     sierpnia: '08',
    //     września: '09',
    //     października: '10',
    //     listopada: '11',
    //     grudnia: '12',
    //   };

    //   let day = (text.match(/(^\d{1,2}(?=.))|((?<= )\d{1,2}(?= ))/))?.[0];
    //   let year = (text.match(/((?<=\.)(\d{2,4})(?= -))|((?<= )(\d{2,4}$))|((?<=\.)(\d{4}$))/))?.[0];
    //   let month = text.match(/(?<=\.)\d{2}(?=\.)/)?.[0];
    //   if (day?.length === 1) day = `0${day}`;
    //   if (year?.length === 2) year = `20${year}`;
    //   if (month === undefined) {
    //     month = (text.match(/(?<=\d )[a-źA-Ź]+/))?.[0];
    //     if (month && Object.hasOwnProperty.call(months, month)) {
    //       month = months[month];
    //     }
    //   }
    //   return `${year}-${month}-${day}`;
    // },
    isPublicPurchase: (text) => {
      if (text?.includes('Zamawiam') || text?.includes('ZAMAWIAM') || text?.includes('Sold Out') || text?.includes('SOLD OUT')) {
        text = true;
        return text;
      }
      if (text?.includes('Czytaj Więcej') || text?.includes('CZYTAJ WIĘCEJ')) {
        text = false;
        return text;
      }
      return text;
    },
  };
  const mappingFct = (header, arr, row) => [...arr.map(({ text, ...other }) => ({ text: mapping[header](text, row), ...other }))];
  data.forEach(obj => obj.group.forEach(row => Object.keys(row).forEach((header) => {
    // eslint-disable-next-line no-param-reassign
    if (mapping[header]) row[header] = mappingFct(header, row[header], row);
  })));
  return data;
};

module.exports = { cleanUp };
