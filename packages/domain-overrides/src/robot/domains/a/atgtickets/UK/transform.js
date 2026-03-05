/* eslint-disable no-param-reassign */
/**
 *
 * @param {ImportIO.Group[]} data
 * @returns {ImportIO.Group[]}
 */
const cleanUp = (data) => {
  const mapping = {
    eventDate: text => new Date(text),
    eventEndDate: (text, row) => {
      const endDate = new Date(text.split(/[-+]\d{2}:\d{2}/g)[0]);
      const duration = row?.duration?.[0]?.text || '';
      const [hours, minutes] = [
        parseInt([...duration.matchAll(/(\d+)[\s]{0,1}hour[s]{0,1}/g)]?.[0]?.[1] || 0, 10),
        parseInt([...duration.matchAll(/(\d+)[\s]{0,1}minute[s]{0,1}/g)]?.[0]?.[1] || 0, 10),
      ];

      console.log(endDate, hours, minutes, endDate.getHours() - hours);

      endDate.setHours(endDate.getHours() - hours);
      endDate.setMinutes(endDate.getMinutes() - minutes);
      row.eventDateTime = [{ text: endDate }];
      return endDate;
    },
    eventDateTime: (text, row) => {
      const utcDate = new Date(text);
      const endDate = row?.eventEndDate?.[0]?.text;
      const timezoneDiffPattern = /([+-]\d{2}):(\d{2})$/;
      const match = endDate.match(timezoneDiffPattern);
      const hours = parseInt(match[1], 10);
      console.log(endDate, match, match[1], utcDate.getUTCHours(), hours, utcDate.getUTCHours() + hours);
      utcDate.setUTCHours(utcDate.getUTCHours() + hours);
      return utcDate;
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
