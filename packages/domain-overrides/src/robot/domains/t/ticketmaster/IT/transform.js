/**
 *
 * @param {ImportIO.Group[]} data
 * @returns {ImportIO.Group[]}
 */
const cleanUp = (data) => {
  const mapping = {
    textDateTime: (text, row) => {
      const italianMonths = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];
      try {
        const [datePart, timePart] = text.split('- h').map(part => part.trim()).filter(v => v);
        // eslint-disable-next-line no-param-reassign
        row.eventDate = [{ text: new Date(Date.UTC(parseInt(datePart.slice(-4), 10), italianMonths.indexOf(datePart.slice(7, 10)), parseInt(datePart.slice(4, 6), 10))).toISOString().split('T')[0] }];
        // eslint-disable-next-line no-param-reassign
        row.eventTime = [{ text: `${timePart.slice(0, 2)}:${timePart.slice(3, 5)}` }];
      } catch (error) {
        console.log('Error parsing datetime:', error);
      }
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
