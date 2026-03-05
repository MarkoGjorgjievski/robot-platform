/* eslint-disable no-param-reassign */
/**
 *
 * @param {ImportIO.Group[]} data
 * @returns {ImportIO.Group[]}
 */
const cleanUp = (data) => {
  const mapping = {
    unitsStock: (text, row) => {
      if (text === 'empty') {
        return row.outOfStock ? '0' : '999';
      }
      return text;
    },
    sku: (text, row) => {
      if (text === 'empty') {
        return row.oneSizeSku?.[0]?.text?.toUpperCase() || null;
      }
      return text;
    },
    // listPrice: text => text.match(priceRegex)?.[1] || text.match(priceRegex)?.[0] || null,
    offerPrice: (text, row) => {
      if (!row.listPrice?.[0]?.text) {
        row.listPrice = [{ text }];
      }
      return text;
    },
    shippingCost: text => text.replace('.', ','),
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
