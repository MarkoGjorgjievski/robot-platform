/* eslint-disable no-param-reassign */
/* eslint-disable linebreak-style */
/**
 *
 * @param {ImportIO.Group[]} data
 * @returns {ImportIO.Group[]}
 */

const cleanUp = (data) => {
  const mapping = {
    alternative_images: text => `${text.replace(/.{0,2}$/, '')}123`,
    weight_raw: (text, row) => {
      row.weight_unit = [{ text: text.match(/[a-z]+/g)[0] }];
      return text.replace(/[a-z]/g, '').replace(/\s/, '').replace(/,/, '.');
    },
    height: (text) => {
      const unit = text.match(/[a-z]+/g);
      let number;
      if (!unit) return text;
      switch (unit[0]) {
        case 'cm':
          number = Number(text.replace(/,/g, '.').match(/\d\S*/g)[0]);
          break;
        case 'm':
          number = Number(text.replace(/,/g, '.').match(/\d\S*/g)[0]) * 100;
          break;
        case 'mm':
          number = Number(text.replace(/,/g, '.').match(/\d\S*/g)[0]) / 10;
          break;
        default:
          number = text;
          break;
      }
      return `${number}`;
    },
    width: (text) => {
      const unit = text.match(/[a-z]+/g);
      let number;
      if (!unit) return text;
      switch (unit[0]) {
        case 'cm':
          number = Number(text.replace(/,/g, '.').match(/\d\S*/g)[0]);
          break;
        case 'm':
          number = Number(text.replace(/,/g, '.').match(/\d\S*/g)[0]) * 100;
          break;
        case 'mm':
          number = Number(text.replace(/,/g, '.').match(/\d\S*/g)[0]) / 10;
          break;
        default:
          number = text;
          break;
      }
      return `${number}`;
    },
    length: (text) => {
      const unit = text.match(/[a-z]+/g);
      let number;
      if (!unit) return text;
      switch (unit[0]) {
        case 'cm':
          number = Number(text.replace(/,/g, '.').match(/\d\S*/g)[0]);
          break;
        case 'm':
          number = Number(text.replace(/,/g, '.').match(/\d\S*/g)[0]) * 100;
          break;
        case 'mm':
          number = Number(text.replace(/,/g, '.').match(/\d\S*/g)[0]) / 10;
          break;
        default:
          number = text;
          break;
      }
      return `${number}`;
    },
  };

  const mappingFct = (header, arr, row) => arr.map(({ text, ...other }) => ({ text: mapping[header](text, row), ...other }));

  data.forEach(obj => obj.group.forEach(row => Object.keys(row).forEach((header) => {
    // eslint-disable-next-line no-param-reassign
    if (mapping[header]) row[header] = mappingFct(header, row[header], row);
  })));

  return data;
};

module.exports = { cleanUp };
