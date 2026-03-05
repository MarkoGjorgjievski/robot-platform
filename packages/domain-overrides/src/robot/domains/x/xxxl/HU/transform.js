/* eslint-disable no-param-reassign */
/**
 *
 * @param {ImportIO.Group[]} data
 * @returns {ImportIO.Group[]}
 */
const cleanUp = (data) => {
  const mapping = {
    product_variations: (text) => {
      const gap = text.split(' ');
      return gap.length > 1 ? gap.join('%') : text;
    },
    colour: (text) => {
      const splittedText = text.split(': ');
      return splittedText[1];
    },
    description: (text) => {
      const index = text.indexOf('➤');
      return text.slice(0, index).trim();
    },
    width: (text) => {
      if (text.includes('/')) {
        const dimensionsArr = text.split('/');
        return dimensionsArr[0] ? dimensionsArr[0] : null;
      }
      return text;
    },
    length: (text) => {
      if (text.includes('/')) {
        const dimensionsArr = text.split('/');
        return dimensionsArr[1] ? dimensionsArr[1] : null;
      }
      return text;
    },
    height: (text) => {
      if (text.includes('/')) {
        const dimensionsArr = text.split('/');
        return dimensionsArr ? dimensionsArr[1] : null;
      }
      return text;
    },
    depth: (text) => {
      if (text.includes('/')) {
        const dimensionsArr = text.split('/');
        return dimensionsArr[2] ? dimensionsArr[2] : null;
      }
      return text;
    },
    // weight_raw: (text) => {
    //   const parts = text?.split('súlya:');
    //   const weightNamed = parts?.[1];
    //   const [weightRow, weightUnit] = weightNamed?.split(' ');
    //   return weightRow;
    // },
    // weight_unit: (text) => {
    //   const parts = text?.split('súlya:');
    //   const weightNamed = parts?.[1];
    //   const [weightRow, weightUnit] = weightNamed?.split(' ');
    //   return weightUnit;
    // },
  };

  const mappingFct = (header, arr, row) => arr.map(({ text, ...other }) => ({ text: mapping[header](text, row), ...other }));

  data.forEach(obj => obj.group.forEach(row => Object.keys(row).forEach((header) => {
    // eslint-disable-next-line no-param-reassign
    if (mapping[header]) row[header] = mappingFct(header, row[header], row);
  })));

  return data;
};

module.exports = { cleanUp };
