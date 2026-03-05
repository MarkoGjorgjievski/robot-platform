/**
 *
 * @param {ImportIO.Group[]} data
 * @returns {ImportIO.Group[]}
 */
//
const cleanUp = (data) => {
  const now = new Date();

  const mapping = {
    isPublicPurchase: text => (new Date(text) < now ? '1' : '0'),
    onSaleDateTime: (text) => {
      // AM: 凌晨, 早上, 上午, 中午, 正午
      // PM: 下午, 傍晚, 晚上

      let dateString = text;
      const sign = text.slice(-2);
      if ((dateString.search(/T\d{2}/)) === -1) {
        dateString = dateString.replace('T', 'T0');
      }
      dateString = dateString.slice(0, -2);
      let date = new Date(dateString);

      if (sign === '下午' || sign === '傍晚' || sign === '晚上') {
        date = new Date(date.getTime() + 12 * 60 * 60 * 1000);
      }
      // if ((text.search(/T\d{2}/)) === -1) {
      //   return (new Date(text.replace('T', 'T0'))).toISOString();
      // }
      return date.toISOString();
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
