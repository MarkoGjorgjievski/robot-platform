/* eslint-disable no-param-reassign */
/**
 *
 * @param {ImportIO.Group[]} data
 * @returns {ImportIO.Group[]}
 */
//
const cleanUp = (data) => {
  const allowedDimensions = /(Breite|Länge|Höhe|Durchmesser)/;

  const getOneDimension = (text, dimension) => {
    const simpleRegex = /(\d+(\.\d+)?)\s*(cm|mm|m)/i;
    const simpleMatch = simpleRegex.exec(text);

    if (simpleMatch) {
      const value = simpleMatch[1];
      const unit = simpleMatch[3];
      if (dimension === 'unit') return unit;
      return value;
    }

    return null;
  };

  const getDimension = (text, dimension) => {
    const labeledRegex = new RegExp(`${dimension}:\\s*([\\d.,]+)\\s*(cm|mm|m)`, 'i');
    const labeledMatch = labeledRegex.exec(text);
    if (labeledMatch) {
      const value = labeledMatch[1];
      const unit = labeledMatch[2];
      if (dimension === 'unit') return unit;
      return value;
    }

    return null;
  };

  const mapping = {
    pack_size: (text) => {
      if (text.indexOf('Stk/Pck') > -1) {
        text = text.split('Stk/Pck')[0].trim();
        const arr = text.split(' ');
        return arr[arr.length - 1];
      }
      return '1';
    },
    stock_availability: text => (text === '0' ? 'no' : 'yes'),
    average_rating: text => text.split(' ')[0],
    original_price: (text, row) => {
      if (text === '0' && row.offer_price && row.offer_price[0] && row.offer_price[0].text) {
        return row.offer_price[0].text.replace(',', '.');
      }
      return text.replace(',', '.');
    },
    offer_price: text => text.replace(',', '.'),
    product_variations: text => `https://jysk.de/node/${text}`,
    // depth: text => text.split('m,').reduce((result, one) => {
    //   const [key, value] = one.split(':');
    //   if (key.trim() === 'Tiefe') {
    //     const val = value.trim().split(' ')[0];
    //     const ret = val.split(/-|\//);
    //     return ret[ret.length - 1].split('\n')[0];
    //   }
    //   return result === '0' ? null : result;
    // }, null),
    // diameter: text => text.split('m,').reduce((result, one) => {
    //   const [key, value] = one.split(':');
    //   if (key.trim() === 'Durchmesser') {
    //     const val = value.trim().split(' ')[0];
    //     const ret = val.split(/-|\//);
    //     return ret[ret.length - 1];
    //   }
    //   return result === '0' ? null : result;
    // }, null),
    // height: text => text.split('m,').reduce((result, one) => {
    //   const [key, value] = one.split(':');
    //   if (key.trim() === 'Höhe') {
    //     const val = value.trim().split(' ')[0];
    //     const ret = val.split(/-|\//);
    //     return ret[ret.length - 1].split('\n')[0];
    //   }
    //   if (result === null && text.indexOf('x') > 0) {
    //     return text.split('x')[1].split(' ')[0];
    //   }
    //   return result === '0' ? null : result;
    // }, null),
    // length: text => text.split('m,').reduce((result, one) => {
    //   const [key, value] = one.split(':');
    //   if (key.trim() === 'Länge') {
    //     const val = value.trim().split(' ')[0];
    //     const ret = val.split(/-|\//);
    //     return ret[ret.length - 1].split('\n')[0].trim();
    //   }
    //   return result === '0' ? null : result;
    // }, null),
    // width: text => text.split('m,').reduce((result, one) => {
    //   const [key, value] = one.split(':');
    //   if (key.trim() === 'Breite') {
    //     const val = value.trim().split(' ')[0];
    //     const ret = val.split(/-|\//);
    //     return ret[ret.length - 1].split('\n')[0];
    //   }
    //   if (result === null && text.indexOf('x') > 0) {
    //     return text.split('x')[0].trim();
    //   }
    //   return result === '0' ? null : result;
    // }, null),
    width: text => getDimension(text, 'Breite'),
    length: text => getDimension(text, 'Länge'),
    depth: text => getDimension(text, 'Tiefe'),
    height: text => getDimension(text, 'Höhe'),
    diameter: text => (allowedDimensions.test(text) ? getDimension(text, 'Durchmesser') : getOneDimension(text)),
    dimensions_unit: text => (allowedDimensions.test(text) ? getDimension(text, 'unit') : getOneDimension(text, 'unit')),
    weight: (text) => {
      const [value, unit] = text.split(' ');
      let weight = value.trim() !== '' ? value.trim() : '0';
      if (unit?.trim() === 'g') {
        weight = parseInt(weight, 10) / 1000;
        return weight.toString();
      }
      return weight === '0' ? null : weight;
    },
  };

  const mappingFct = (header, arr, row) => [...arr.map(({ text, ...other }) => ({ text: mapping[header](text, row), ...other }))];

  data.forEach((obj) => {
    obj.group.forEach(row => Object.keys(row).forEach((header) => {
      // eslint-disable-next-line no-param-reassign
      if (mapping[header]) row[header] = mappingFct(header, row[header], row);
    }));
  });
  return data;
};

module.exports = { cleanUp };
