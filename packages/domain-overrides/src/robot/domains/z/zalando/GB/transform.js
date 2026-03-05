/**
 *
 * @param {ImportIO.Group[]} data
 * @returns {ImportIO.Group[]}
 */
const cleanUp = (data) => {
  const priceRegex = /([$€£¥¢₽][\d.,]+)/g;
  const mapping = {
    unitsStock: (text, row) => {
      if (row.outOfStock || row.outOfStockBackup) return '0';
      if (!row.outOfStock?.[0]?.text) return text === 'empty' ? '999' : text;
      return '0';
    },
    resellerName: text => (text.includes('zalando') ? 'Zalando' : text),
    offerPrice: (text) => {
      const match = text.match(priceRegex);
      return match && match.length > 1 ? match[0] : null;
    },
    listPrice: (text) => {
      const match = text.match(priceRegex);
      return match && match.length > 1 ? match[1] : match[0];
    },
    sku: (text, row) => {
      if (text === 'empty') {
        return row.oneSizeSku?.[0]?.text?.toUpperCase() || null;
      }
      return text;
    },
    resellerId: (text, row) => {
      const dict = JSON.parse(row.resellerIdMap?.[0]?.text || {});
      let query = text;
      if (text === 'Brand') {
        query = row.resellerNameFallback?.[0]?.text || 'Zalando';
      }
      return dict?.[query] || '810d1d00-4312-43e5-bd31-d8373fdd24c7';
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
