/**
 *
 * @param {ImportIO.Group[]} data
 * @returns {ImportIO.Group[]}
 */
const cleanUp = (data) => {
  const mapping = {
    eventDateTimeStart: (text, row) => {
      // eslint-disable-next-line no-param-reassign
      row.eventDateTime = [{ text }];
    },
    eventDateTimeDoor: (text, row) => {
      const currentDateTime = row.eventDateTime?.[0]?.text;
      // eslint-disable-next-line no-param-reassign
      row.eventDateTime = [{ text: currentDateTime || text }];
    },
    isPublicPurchase: (text, row) => {
      const isCancelled = row.isCancelled?.[0]?.text;
      const isPostponed = row.isPostponed?.[0]?.text;
      const onSaleDate = row.onSaleDate?.[0]?.text;

      if (isCancelled === 'true' || isPostponed === 'true') return '0';
      if ((new Date(onSaleDate)).getTime() > (new Date()).getTime()) return '1';
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
