// @ts-nocheck
/* eslint-disable no-param-reassign */
/**
*
* @param {ImportIO.Group[]} data
* @returns {ImportIO.Group[]}
*/
const cleanUp = (data) => {
  const toNum = (txt) => {
    const extractedNB = txt.replace(/,/g, '.').match(/(\d+\.\d{1,2})/g)?.[0] || '0';
    return parseFloat(extractedNB);
  };
  // const priceRegex = /([\d.,]+)\s+[$€£¥¢₽]/g;
  const mapping = {
    unitsStock: (text, row) => {
      if (!row.outOfStock?.[0]?.text) return text === 'empty' ? '999' : text;
      return '0';
    },
    // sku: (text, row) => {
    //   if (text === 'empty') {
    //     return row.oneSizeSku?.[0]?.text?.toUpperCase() || null;
    //   }
    //   return text;
    // },
    oneSizeSku: (textLower, row) => {
      const text = textLower.toUpperCase();
      if (row.sku?.[0]?.text === 'empty') {
        row.sku = [{ text }];
        row.productSKU = [{ text }];
      }
      return text;
    },
    shippingCost: text => text.replace(/,/g, '.'),
    listPrice: text => toNum(text),
    offerPrice: (text, row) => (toNum(text) === toNum(row.listPrice?.[0]?.text) ? '' : text),
    // listPrice: (text) => {
    //   text = text.replace(/,/g, '.');
    //   text = text.match(/(\d+\.\d{1,2})/g)?.[0];
    //   return text;
    // },
    // offerPrice: (text, row) => {
    //   text = text.replace(/,/g, '.');
    //   text = text.match(/(\d+\.\d{1,2})/g)?.[0];
    //   if (+text === +(row.listPrice?.[0]?.text || 0)) text = '';
    //   return text;
    // },
    // offerPrice: (text, row) => row.offerPrice_raw?.[0]?.text
    //   ?.match(priceRegex)?.[0]?.match(/[\d.,]+/)?.[0] || '0',
    // listPrice: text => text.match(priceRegex)?.pop()?.match(/[\d.,]+/)?.[0] || '0',
    resellerId: (text, row) => {
      const dict = JSON.parse(row.resellerIdMap?.[0]?.text || {});
      let query = text;
      if (text === 'Brand' || (text === 'Zalando' && row.outOfStock_backup === '0')) {
        query = row.resellerNameFallback?.[0]?.text || 'Zalando';
      }
      return dict?.[query] || '810d1d00-4312-43e5-bd31-d8373fdd24c7';
    },
    resellerName: (text, row) => {
      if (text === 'Brand' || (text === 'Zalando' && row.outOfStock_backup === '0')) {
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
        row[header] = transformedValues;
      }
    });
  }));
  return data;
};
module.exports = { cleanUp };
