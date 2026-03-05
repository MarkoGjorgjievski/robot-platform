/* eslint-disable no-param-reassign
*/
/**
 *
 * @param {ImportIO.Group[]} data
 * @returns {ImportIO.Group[]}
 */

const cleanUp = (data) => {
  const mapping = {
    eventTimeDescription: (text, row) => {
      const time = text.match(/(?<=godz. )(\d{2}:\d{2})/)?.[0];
      if (time !== undefined) {
        row.eventTime = [{ text: `${time}` }];
      }
      return time;
    },
    isDateTimeTBA: (text, row) => {
      if (!row.eventTime?.[0]?.text) {
        row.eventTime = [{ text: '13:00' }];
        text = true;
      }
      return text;
    },
    eventName: (text) => {
      text = text.replace(/(STYCZNIA|stycznia)/g, '01');
      text = text.replace(/(LUTEGO|lutego)/g, '02');
      text = text.replace(/(MARCA|marca)/g, '03');
      text = text.replace(/(KWIETNIA|kwietnia)/g, '04');
      text = text.replace(/(MAJA|maja)/g, '05');
      text = text.replace(/(CZERWCA|czerwca)/g, '06');
      text = text.replace(/(LIPCA|lipca)/g, '07');
      text = text.replace(/(SIERPNIA|sierpnia)/g, '08');
      text = text.replace(/(WRZEŚNIA|września)/g, '09');
      text = text.replace(/(PAŹDZIERNIKA|października)/g, '10');
      text = text.replace(/(LISTOPADA|listopada)/g, '11');
      text = text.replace(/(GRUDNIA|grudnia)/g, '12');
      text = text.replace(/(\d{1,2}.\d{2}.\d{4} \/ \d{2}.\d{2})/g, '');
      text = text.replace(/(\d{2}\.\d{2}\.\d{4} g\. \d{2}\.\d{2})/g, '');
      text = text.replace(/(\d{2}\.\d{2}\.\d{2} g\. \d{2}\.\d{2})/g, '');
      text = text.replace(/(\d{2}\.\d{2}\.\d{4} \/ g\.\d{2}:\d{2})/g, '');
      text = text.replace(/(\d{2}\.\d{2}\.\d{4} r\. \/ godz. \d{2}:\d{2})/g, '');
      text = text.replace(/(\d{2}\.\d{2}\.\d{2} g.\d{2}\.\d{2})/g, '');
      text = text.replace(/(\d{1,2}\. \d{2}\. \d{4}, godz\. \d{2}\.\d{2})/g, '');
      text = text.replace(/(\d{1,2}\.\d{2}\.\d{4})/g, '');
      text = text.replace(/((\d{2}-\d{2})|(\d{2}))(\.\d{2}\.\d{4} r\. godz\. \d{2}:\d{2})/g, '');
      text = text.replace(/(\d{2}\.\d{2}\.\d{2}, g\. \d{2}:\d{2})/g, '');
      text = text.replace(/(\d{1,2}\.\d{2}\.\d{2,4}, g. \d{2}.\d{2})/g, '');
      text = text.replace(/(\d{1,2}\.\d{2}\.\d{2,4})/g, '');
      text = text.replace(/(\(\d{1,2}\.\d{2}\))/g, '');
      text = text.replace(/(\d{1,2}\.\d{2})/g, '');
      text = text.replace(/(\d{1,2}.\d{2})/g, '');
      return text;
    },
    eventDate: (text) => {
      const day = text.match(/^\d{2}(?=.)/)?.[0];
      const month = text.match(/(?<=\.)\d{2}(?=\.)/)?.[0];
      const year = text.match(/\d{4}$/)?.[0];
      return `${year}-${month}-${day}`;
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
