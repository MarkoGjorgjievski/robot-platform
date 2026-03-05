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
      if (text.toLowerCase().indexOf('pack of') > -1) {
        text = text.toLowerCase().split('pack of')[1].trim();
        return parseInt(text, 10);
      }
      return '1';
    },
    offer_price: (text) => {
      text = text.substring(text.indexOf('initialFinalPrice:') + 18);
      text = text.substring(0, text.indexOf(',')).trim();
      if (Number.isNaN(parseFloat(text))) {
        return null;
      }
      return text;
    },
    original_price: (text, row) => {
      if (text === '0' && row.offer_price && row.offer_price[0] && row.offer_price[0].text) {
        return row.offer_price[0].text.replace(',', '.');
      }
      text = text.substring(text.indexOf('regular_price') + 13);
      text = text.substring(text.indexOf('value:') + 6);
      text = text.substring(0, text.indexOf(',')).trim();
      if (Number.isNaN(parseFloat(text))) {
        return null;
      }
      return text;
    },
    stock_availability: text => (text === 'no' ? 'no' : 'yes'),
    average_rating: (text) => {
      text = text.substring(text.indexOf('"productData":') + 15);
      [text] = text.substring(text.indexOf('ratingTitle') + 14).split('"');
      [text] = text.split(' ');
      return Number.isNaN(text) ? 0 : text;
    },
    user_reviews: (text) => {
      text = text.substring(text.indexOf('"productData":') + 15);
      [text] = text.substring(text.indexOf('reviewsCount') + 15).split('"');
      if (text.indexOf(',') > -1) {
        [text] = text.split(',');
      }
      return Number.isNaN(text) ? 0 : text;
    },
    product_variations: text => `https://jysk.ca/node/${text}`,
    depth: (text) => {
      let result = null;
      text = text.replace(/[0-9] D/, 'x D');
      const arr = text.split('x');
      arr.every((one) => {
        const [key, value] = one.trim().split(' ');
        if (key.trim() === 'D') {
          result = value.trim();
          return false;
        }
        result = result === '0' || result === '' ? null : result;
        return true;
      });
      if (result?.indexOf('-') > -1) {
        [, result] = result.split('-');
      }
      return result?.replace('cm', '');
    },
    diameter: (text) => {
      let result = null;
      text = text.replace(/[0-9] Ø/, 'x Ø');
      const arr = text.split('x');
      arr.every((one) => {
        const [key, value] = one.trim().split(' ');
        if (key.trim() === 'Ø') {
          result = value.trim();
          return false;
        }
        result = result === '0' || result === '' ? null : result;
        return true;
      });
      if (result?.indexOf('-') > -1) {
        [, result] = result.split('-');
      }
      return result?.replace('cm', '');
    },
    height: (text) => {
      let result = null;
      const htext = text.replace(/[0-9] H/, 'x H');
      const arr = htext.split('x');
      arr.every((one) => {
        const [key, value] = one.trim().split(' ');
        if (key.trim() === 'H') {
          result = value.trim();
          return false;
        }
        result = result === '0' || result === '' ? null : result;
        return true;
      });
      if (result?.indexOf('-') > -1) {
        [, result] = result.split('-');
      }
      if (result === null) {
        const regex = /([\d.]+) x ([\d.]+) ?x? ?([\d.]+)? cm/;
        const match = text.match(regex);
        if (match && match[3]) return match[3];
      }
      return result?.replace('cm', '');
    },
    length: (text) => {
      let result = null;
      const ltext = text.replace(/[0-9] L/, 'x L');
      const arr = ltext.split('x');
      arr.every((one) => {
        const [key, value] = one.trim().split(' ');
        if (key.trim() === 'L') {
          result = value.trim();
          return false;
        }
        result = result === '0' || result === '' ? null : result;
        return true;
      });
      if (result?.indexOf('-') > -1) {
        [, result] = result.split('-');
      }

      if (result === null) {
        const regex = /([\d.]+) x ([\d.]+) ?x? ?([\d.]+)? cm/;
        const match = text.match(regex);
        if (match && match[1]) return match[1];
      }
      return result?.replace('cm', '');
    },
    width: (text) => {
      let result = null;
      const wtext = text.replace(/[0-9] W/, 'x W');
      const arr = wtext.split('x');
      arr.every((one) => {
        const [key, value] = one.trim().split(' ');
        if (key.trim() === 'W') {
          result = value.trim();
          return false;
        }
        result = result === '0' || result === '' ? null : result;
        return true;
      });
      if (result?.indexOf('-') > -1) {
        [, result] = result.split('-');
      }
      if (result === null) {
        const regex = /([\d.]+) x ([\d.]+) ?x? ?([\d.]+)? cm/;
        const match = text.match(regex);
        if (match && match[2]) return match[2];
      }
      return result?.replace('cm', '');
    },
    weight: (text) => {
      if (text.indexOf(':') > -1) {
        text = text.split(':')[1].trim();
      }
      let [value] = text.split(' ');
      value = value.trim();
      if (Number.isNaN(parseFloat(value))) {
        value = null;
      }
      return value;
    },
    package_weight: (text, row) => {
      if (text.indexOf(':') > -1) {
        text = text.split(':')[1].trim();
      }
      let [value] = text.split(' ');
      value = value.trim();
      if (Number.isNaN(parseFloat(value))) {
        value = null;
      }
      if (value !== null && value !== '' && value !== '0') {
        row.weight = [{ text: value }];
      }
      return value;
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
