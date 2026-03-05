/**
 *
 * @param {ImportIO.Group[]} data
 * @returns {ImportIO.Group[]}
 */
const cleanUp = (data) => {
  const mapping = {
    offer_price: (text, row) => (text === row.original_price[0]?.text ? null : text),
    weight_unit: (text) => {
      switch (text.toUpperCase()) {
        case 'O':
          return 'oz';
        case 'K':
          return 'kg';
        case 'M':
          return 'mg';
        case 'G':
          return 'g';
        case 'T':
          return null;
        default:
          return text;
      }
    },
    height: (text) => {
      const arr = text.split('x');
      const match = arr[2] ? arr[2].match(/[0-9,.]+/g) : null;
      return match ? match[0] : null;
    },
    width: (text) => {
      const arr = text.split('x');
      const match = arr[1] ? arr[1].match(/[0-9,.]+/g) : null;
      return match ? match[0] : null;
    },
    length: (text) => {
      const arr = text.split('x');
      const match = arr[0] ? arr[0].match(/[0-9,.]+/g) : null;
      return match ? match[0] : null;
    },
    materials: (text, row) => (text === 'dummy' ? row.materials_backup?.[0]?.text.trim().replace(/[\u200e\u200f\u202a-\u202e]/g, '') : text.trim().replace(/[\u200e\u200f\u202a-\u202e]/g, '')),
    description: text => text.replace('Amazon.fr:', ''),
    pack_size: text => text.trim().replace(/\s+/g, '').substring(1),
    weight_raw: (text) => {
      const regex = /(\d+(?:,\d+)?)\s*grammes?/i;
      const match = text.match(regex);
      if (match) {
        return match[1];
      }
      return text.match(/(\d+)/)[0];
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
