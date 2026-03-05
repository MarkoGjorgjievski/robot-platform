/* eslint-disable no-param-reassign */
/**
 *
 * @param {ImportIO.Group[]} data
 * @returns {ImportIO.Group[]}
 */
//
const cleanUp = (data) => {
  const mapping = {
    productURL: text => (`https://www.obramat.es${text}`),
    original_price: text => text.replace(/,/g, '.').match(/\d\S*/)[0],
    weight_raw: (text) => {
      if (text.includes('kg)')) {
        return Number(text.replace(/,/g, '.').match(/\d\S*/g)[0]);
      }

      if (text.includes('t)')) {
        return Number(text.replace(/,/g, '.').match(/\d\S*/g)[0]) * 1000;
      }

      if (text.includes('dag)')) {
        return Number(text.replace(/,/g, '.').match(/\d\S*/g)[0]) / 100;
      }

      if (text.includes('g)')) {
        return Number(text.replace(/,/g, '.').match(/\d\S*/g)[0]) / 1000;
      }
      return text;
    },
    volume: (text, row) => {
      const biggerVolume = text.replace(/,/g, '.').match(/(?<=a\s)(\d\S*)/g);
      if (row.weight_raw && text.includes('litros') && biggerVolume) {
        return Number(biggerVolume[0]);
      }

      if (row.weight_raw && text.includes('litros')) {
        return Number(text.replace(/,/g, '.').match(/\d\S*/g)[0]);
      }

      if (text.includes('litros')) {
        row.weight_unit = [{ text: 'l' }];
        return Number(biggerVolume[0]);
      }

      if (text.includes('litros')) {
        row.weight_unit = [{ text: 'l' }];
        return Number(text.replace(/,/g, '.').match(/\d\S*/g)[0]);
      }

      return text;
    },
    height: (text) => {
      if (text.includes('cm)')) {
        return Number(text.replace(/,/g, '.').match(/\d\S*/g)[0]);
      }

      if (text.includes('dm)')) {
        return Number(text.replace(/,/g, '.').match(/\d\S*/g)[0]) * 10;
      }

      if (text.includes('km)')) {
        return Number(text.replace(/,/g, '.').match(/\d\S*/g)[0]) * 100000;
      }

      if (text.includes('mm)')) {
        return Number(text.replace(/,/g, '.').match(/\d\S*/g)[0]) / 10;
      }

      return Number(text.replace(/,/g, '.').match(/\d\S*/g)[0]) * 100;
    },
    length: (text) => {
      if (text.includes('cm)')) {
        return Number(text.replace(/,/g, '.').match(/\d\S*/g)[0]);
      }

      if (text.includes('dm)')) {
        return Number(text.replace(/,/g, '.').match(/\d\S*/g)[0]) * 10;
      }

      if (text.includes('km)')) {
        return Number(text.replace(/,/g, '.').match(/\d\S*/g)[0]) * 100000;
      }

      if (text.includes('mm)')) {
        return Number(text.replace(/,/g, '.').match(/\d\S*/g)[0]) / 10;
      }

      return Number(text.replace(/,/g, '.').match(/\d\S*/g)[0]) * 100;
    },
    width: (text) => {
      if (text.includes('cm)')) {
        return Number(text.replace(/,/g, '.').match(/\d\S*/g)[0]);
      }

      if (text.includes('dm)')) {
        return Number(text.replace(/,/g, '.').match(/\d\S*/g)[0]) * 10;
      }

      if (text.includes('km)')) {
        return Number(text.replace(/,/g, '.').match(/\d\S*/g)[0]) * 100000;
      }

      if (text.includes('mm)')) {
        return Number(text.replace(/,/g, '.').match(/\d\S*/g)[0]) / 10;
      }

      return Number(text.replace(/,/g, '.').match(/\d\S*/g)[0]) * 100;
    },
    depth: (text) => {
      if (text.includes('cm)')) {
        return Number(text.replace(/,/g, '.').match(/\d\S*/g)[0]);
      }

      if (text.includes('dm)')) {
        return Number(text.replace(/,/g, '.').match(/\d\S*/g)[0]) * 10;
      }

      if (text.includes('km)')) {
        return Number(text.replace(/,/g, '.').match(/\d\S*/g)[0]) * 100000;
      }

      if (text.includes('mm)')) {
        return Number(text.replace(/,/g, '.').match(/\d\S*/g)[0]) / 10;
      }

      return Number(text.replace(/,/g, '.').match(/\d\S*/g)[0]) * 100;
    },
    diameter: (text) => {
      if (text.includes('cm)')) {
        return Number(text.replace(/,/g, '.').match(/\d\S*/g)[0]);
      }

      if (text.includes('dm)')) {
        return Number(text.replace(/,/g, '.').match(/\d\S*/g)[0]) * 10;
      }

      if (text.includes('km)')) {
        return Number(text.replace(/,/g, '.').match(/\d\S*/g)[0]) * 100000;
      }

      if (text.includes('mm)')) {
        return Number(text.replace(/,/g, '.').match(/\d\S*/g)[0]) / 10;
      }

      return Number(text.replace(/,/g, '.').match(/\d\S*/g)[0]) * 100;
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
