/**
 *
 * @param {ImportIO.Group[]} data
 * @returns {ImportIO.Group[]}
 */
//
const cleanUp = (data) => {
  const mapping = {
    isPublicPurchase: (text, row) => {
      const now = new Date();
      const unavailable = row.unavailable?.[0].text;
      return (!unavailable) && new Date(text) < now;
    },
    eventURL: (text, row) => {
      if (text === 'https://l-tike.com/order/') {
        const gLcode = row.gLcode?.[0].text;
        const gPfKey = row.gPfKey?.[0].text;
        const gBaseVenueCd = row.gBaseVenueCd?.[0].text;
        const gScheduleNo = row.gScheduleNo?.[0].text;
        return `https://l-tike.com/order/?gLcode=${gLcode}&gScheduleNo=${gScheduleNo}&gPfKey=${gPfKey}&gBaseVenueCd=${gBaseVenueCd}`;
        // return `https://l-tike.com/order/?gLcode=${gLcode}&gScheduleNo=${gScheduleNo}&gEntryMthd=03`;
      }

      return text;
    },
    eventTime: text => text || '15:00',
    isDateTimeTBA: text => (text ? '0' : '1'),
    eventDateTime: (text, row) => {
      const eventTime = row.eventTime?.[0].text;
      return `${text}T${eventTime}`;
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
