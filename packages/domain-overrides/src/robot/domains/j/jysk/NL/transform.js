/* eslint-disable no-param-reassign */
/**
 *
 * @param {ImportIO.Group[]} data
 * @returns {ImportIO.Group[]}
 */
//
const cleanUp = (data) => {
  const mapping = {
    pack_size: (text) => {
      if (text.indexOf('st/pk') > -1) {
        text = text.split('st/pk')[0].trim();
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
    product_variations: text => `https://jysk.nl/node/${text}`,
    depth: text => text.split('m,').reduce((result, one) => {
      const [key, value] = one.split(':');
      if (key.trim() === 'Diepte') {
        const val = value.trim().split(' ')[0];
        const ret = val.split(/-|\+|\//);
        return ret[ret.length - 1].split('\n')[0];
      }
      return result === '0' ? null : result;
    }, null),
    diameter: text => text.split('m,').reduce((result, one) => {
      const [key, value] = one.split(':');
      if (key.trim() === 'Diameter') {
        const val = value.trim().split(' ')[0];
        const ret = val.split(/-|\+|\//);
        return ret[ret.length - 1].split('\n')[0];
      }
      return result === '0' ? null : result;
    }, null),
    height: text => text.split('m,').reduce((result, one) => {
      const [key, value] = one.split(':');
      if (key.trim() === 'Hoogte') {
        const val = value.trim().split(' ')[0];
        const ret = val.split(/-|\+|\//);
        return ret[ret.length - 1].split('\n')[0];
      }
      if (result === null && text.indexOf('x') > 0) {
        return text.split('x')[1].split(' ')[0];
      }
      return result === '0' ? null : result;
    }, null),
    length: text => text.split('m,').reduce((result, one) => {
      const [key, value] = one.split(':');
      if (key.trim() === 'Lengte') {
        const val = value.trim().split(' ')[0];
        const ret = val.split(/-|\+|\//);
        return ret[ret.length - 1].split('\n')[0];
      }
      return result === '0' ? null : result;
    }, null),
    width: text => text.split('m,').reduce((result, one) => {
      const [key, value] = one.split(':');
      if (key.trim() === 'Breedte') {
        const val = value.trim().split(' ')[0];
        const ret = val.split(/-|\+|\//);
        return ret[ret.length - 1].split('\n')[0];
      }
      if (result === null && text.indexOf('x') > 0) {
        return text.split('x')[0].trim();
      }
      return result === '0' ? null : result;
    }, null),
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
