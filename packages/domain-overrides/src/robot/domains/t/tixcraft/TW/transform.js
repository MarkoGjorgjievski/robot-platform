/* eslint-disable sonarjs/no-nested-template-literals */
/* eslint-disable prefer-destructuring */
/* eslint-disable no-shadow */
/* eslint-disable no-param-reassign */
/**
 *
 * @param {ImportIO.Group[]} data
 * @returns {ImportIO.Group[]}
 */
//
const cleanUp = (data) => {
  const TAIWAN_TIMEZONE_OFFSET = 8;

  const mapping = {
    // eventTime: (text, row) => {
    //   if (text !== '0') return text;
    //   row.isDateTimeTBA = [{ text: 1 }];
    //   return '15:00';
    // },
    eventNameTmp: (text, row) => {
      if (!row.eventName?.[0]?.text) row.eventName = [{ text }];
      return text;
    },
    venueNameTmp: (text, row) => {
      if (!row.venueName?.[0]?.text) {
        if (!text.includes(':')) {
          row.venueName = [{ text }];
        }
        if (text.includes(':')) {
          row.venueName = [{ text: text.split(': ')[1] }];
        }
        if (text.includes('：')) {
          row.venueName = [{ text: text.split('：')[1] }];
        }
      }
      return text;
    },
    buyTicket: (text, row) => {
      if (!row.onSaleDateTime?.[0]?.text && text === 'Find tickets') {
        row.isPublicPurchase = [{ text: true }];
      }
      return text;
    },
    eventDateTmp: (text, row) => {
      if (!row.eventDate?.[0]?.text) {
        const date = text.match(/\d{4}.(\d{2}|\d{1}).(\d{2}|\d{1})/)[0];
        date.replace(/\./g, '/');
        row.eventDate = [{ text: `${date}` }]; // [{ text: text.match(/(\d{4}.\d{2}.\d{2})/)[0] }];   text.match(/\d{4}.(\d{2}|\d{1}).(\d{2}|\d{1})/)[0]
      }
      return text;
    },
    eventTimeTmp: (text, row) => {
      if (!row.eventTime?.[0]?.text) {
        if (text === 'Nothing') {
          row.isDateTimeTBA = [{ text: 1 }];
          row.eventTime = [{ text: '15:00' }];
          return text;
        }
        if (!text.includes('AM') && !text.includes('PM')) {
          let timetmp = text.match(/(\d{2}|\d{1})(?=:)/)[0];
          timetmp = parseInt(timetmp, 10);
          timetmp += text.match(/:\d{2}/)[0];
          row.eventTime = [{ text: `${timetmp}` }];
        } else {
          let timeampm;
          if (!text.includes(':')) timeampm = text.match(/(\d{2}|\d{1})(?=AM|PM)/)[0];
          if (text.includes(':')) timeampm = text.match(/(\d{2}|\d{1})(?=:)/)[0];
          const ampm = text.match(/(?<=\d{1})AM|PM/)[0];
          if (ampm.includes('AM') && timeampm === 12) {
            timeampm = parseInt(timeampm, 10);
            timeampm += 12;
          }
          if (ampm.includes('PM') && timeampm !== 12) {
            timeampm = parseInt(timeampm, 10);
            timeampm += 12;
          }
          timeampm = parseInt(timeampm, 10);
          if (!String(timeampm).includes(':')) {
            timeampm += ':00';
          }
          row.eventTime = [{ text: `${timeampm}` }];
        }
      }
      return text;
    },
    onSaleDateTime: (text, row) => {
      const arr = text.split('|');
      let time;
      const currentTime = new Date();
      if (arr?.length === 2) {
        const [d, t] = text.split('|')[0].trim().split(' ');
        const day = d.split('/')[0];
        const month = d.split('/')[1];
        let timetmp = t.match(/(\d{2}|\d{1})(?=:)/)?.[0];
        timetmp = parseInt(timetmp, 10);
        timetmp -= TAIWAN_TIMEZONE_OFFSET;
        timetmp += t.match(/:\d{2}/)[0];
        time = `${currentTime.getFullYear()}-${day.length < 2 ? `0${day}` : day}-${month.length < 2 ? `0${month}` : month} ${timetmp}:00`;
      } else {
        let date = text.match(/(\d{3,4}\/\d{2}\/\d{1,2})/)?.[0];
        if (date === undefined) {
          date = text.match(/(\d{2}\/\d{2})/)?.[0];
        }
        let timeampm = text.match(/\d{2}(?=AM|PM)/)?.[0];
        const ampm = text.match(/(?<=\d{1})AM|PM/)?.[0];
        if (ampm.includes('AM') && parseInt(timeampm, 10) === 12) {
          timeampm = parseInt(timeampm, 10);
          timeampm += 12;
        }
        if (ampm.includes('PM') && parseInt(timeampm, 10) !== 12) {
          timeampm = parseInt(timeampm, 10);
          timeampm += 12;
        }
        timeampm = parseInt(timeampm, 10);
        timeampm -= TAIWAN_TIMEZONE_OFFSET;
        if (!String(timeampm).includes(':')) {
          timeampm += ':00';
        }
        time = `${date} ${timeampm}:00`;
      }
      if (time < currentTime.getDate) {
        row.isPublicPurchase = [{ text: true }];
      }
      return time;
    },
    preSaleDate: (text) => {
      const arr = text.split('|');
      let time;
      const currentTime = new Date();
      if (arr?.length === 2) {
        const [d, t] = text.split('|')[0].trim().split(' ');
        const day = d.split('/')[0];
        const month = d.split('/')[1];
        let timetmp = t.match(/(\d{2}|\d{1})(?=:)/)[0];
        timetmp = parseInt(timetmp, 10);
        timetmp -= TAIWAN_TIMEZONE_OFFSET;
        timetmp += t.match(/:\d{2}/)[0];
        time = `${currentTime.getFullYear()}-${day.length < 2 ? `0${day}` : day}-${month.length < 2 ? `0${month}` : month} ${timetmp}:00`;
      } else {
        const date = text.match(/(\d{4}\/\d{2}\/\d{1,2})/)[0];
        let timeampm = text.match(/\d{2}(?=AM|PM)/)[0];
        const ampm = text.match(/(?<=\d{1})AM|PM/)[0];
        if (ampm.includes('AM') && parseInt(timeampm, 10) === 12) {
          timeampm = parseInt(timeampm, 10);
          timeampm += 12;
        }
        if (ampm.includes('PM') && parseInt(timeampm, 10) !== 12) {
          timeampm = parseInt(timeampm, 10);
          timeampm += 12;
        }
        timeampm = parseInt(timeampm, 10);
        timeampm -= TAIWAN_TIMEZONE_OFFSET;
        if (!String(timeampm).includes(':')) {
          timeampm += ':00';
        }
        time = `${date} ${timeampm}:00`;
      }
      return time;
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
