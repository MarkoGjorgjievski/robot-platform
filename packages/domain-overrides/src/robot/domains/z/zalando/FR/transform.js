/* eslint-disable no-param-reassign */
/**
 *
 * @param {ImportIO.Group[]} data
 * @returns {ImportIO.Group[]}
 */
const cleanUp = (data) => {
  const mapping = {
    unitsStock: (text, row) => {
      if (!row.outOfStock?.[0]?.text) return text === 'empty' ? '999' : text;
      return '0';
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
    resellerId: (text, row) => {
      const dict = JSON.parse(row.resellerIdMap?.[0]?.text || {});
      const query = text === 'Brand'
        ? row.resellerNameFallback?.[0]?.text || 'Zalando'
        : text;
      return dict?.[query] || '810d1d00-4312-43e5-bd31-d8373fdd24c7';
    },
    resellerName: (text, row) => (text === 'Brand'
      ? row.resellerNameFallback?.[0]?.text || 'Zalando'
      : text),
    listPrice: (text, row) => {
      if (!row.price) return '0';

      const prices = row.price.map(price => price.text.match(/[\d,.]+/)?.[0]?.replace(',', '.'));

      if (!prices) return '0';
      row.price = [{ text: prices[0] }];

      if (prices.length === 1) {
        return prices[0];
      }

      const sorted = prices.sort((a, b) => a - b);

      row.offerPrice = [{ text: sorted[0] }];

      return `${sorted[1]}`;
    },
    shippingCost: text => text.replace(',', '.'),
    priceFallback: (text, row) => {
      const offer = JSON.parse(text).find(
        el => el.sku === row.sku?.[0]?.text,
      );

      if (offer) {
        const outOfStock = offer.availability?.includes('OutOfStock');
        if (outOfStock) {
          row.unitsStock = [{ text: '0' }];
          // row.price = [{ text: offer.price }];
          row.listPrice = [{ text: offer.price }];
        }
      }
    },
  };

  const mappingFct = (header, arr, row) => [
    ...arr.map(({ text, ...other }) => ({
      text: mapping[header](text, row),
      ...other,
    })),
  ];

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
