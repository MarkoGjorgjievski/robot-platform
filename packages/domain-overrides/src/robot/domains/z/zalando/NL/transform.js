/* eslint-disable no-param-reassign */
/**
 *
 * @param {ImportIO.Group[]} data
 * @returns {ImportIO.Group[]}
 */
const cleanUp = (data) => {
  const priceRegex = /[$€£¥¢₽]\s*([\d.,]+)/g;
  const mapping = {
    unitsStock: (text, row) => {
      if (row.outOfStock) {
        return '0';
      }
      if (text === 'empty') {
        return row.unitsStock_backup?.[0]?.text || '0';
      }
      return text;
    },
    sku: (text, row) => {
      if (text === 'empty') {
        return row.oneSizeSku?.[0]?.text?.toUpperCase() || null;
      }
      return text;
    },
    productSKU: (text, row) => {
      if (text === 'empty') {
        return row.oneSizeSku?.[0]?.text?.toUpperCase() || null;
      }
      return text;
    },
    offerPrice_raw: (text, row) => {
      const value = text.match(priceRegex)?.[0]?.match(/[\d.,]+/)?.[0];
      if (!row.outOfStock && value) {
        row.offerPrice = [{ text: value }];
      }
      return text;
    },
    // offerPrice: (text, row) => row.offerPrice_raw?.[0]?.text
    //   ?.match(priceRegex)?.[0]?.match(/[\d.,]+/)?.[0] || '0',
    listPrice: text => text.match(priceRegex)?.pop()?.match(/[\d.,]+/)?.[0] || '0',
    resellerId: (text, row) => {
      const dict = JSON.parse(row.resellerIdMap?.[0]?.text || {});
      let query = text;
      if (text === 'Brand') {
        query = row.resellerNameFallback?.[0]?.text || 'Zalando';
      }
      return dict?.[query] || '810d1d00-4312-43e5-bd31-d8373fdd24c7';
    },
    resellerName: (text, row) => {
      if (text === 'Brand') {
        return (row.resellerNameFallback?.[0]?.text || 'Zalando');
      }
      return text;
    },
  };

  const mappingFct = (header, arr, row) => [...arr.map(({ text, ...other }) => ({ text: mapping[header](text, row), ...other }))];

  data.forEach(obj => obj.group.forEach((row) => {
    Object.keys(row).forEach((header) => {
      if (mapping[header]) {
        const transformedValues = mappingFct(header, row[header], row);
        // eslint-disable-next-line no-param-reassign
        row[header] = transformedValues;
      }
    });
  }));
  return data;
};
module.exports = { cleanUp };
