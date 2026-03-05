/* eslint-disable no-param-reassign */
/**
 *
 * @param {ImportIO.Group[]} data
 * @returns {ImportIO.Group[]}
 */
const cleanUp = (data) => {
  const mapping = {
    exPrice: (text, row) => {
      const newPrice = row.original_price[0].text;
      row.original_price = [{ text }];
      row.offer_price = [{ text: newPrice }];
    },
    pack_size: (text, row) => {
      const packNumber = text.match(/\d+(?=pk)/g);
      if (packNumber) return packNumber[0];

      const title = row.product_title?.[0].text;
      const packNumberTitle = title.match(/(?<=Set)(.*)\d+/) || title.match(/(?<=set)(.*)\d+/);

      if (packNumberTitle) return packNumberTitle[0].match(/\d+/)[0];
      return '1';
    },
    // eslint-disable-next-line sonarjs/cognitive-complexity
    description: (text, row) => {
      // dimensions
      const dimensions = text.toLowerCase().match(/(.*)cm/g);
      let dimensionsString = '';
      if (!dimensions) return text;

      dimensions.forEach((dimension) => {
        dimensionsString = `${dimensionsString}${dimension}\n`;
      });

      if (dimensionsString.match(/\d\S*\sx\s\d\S*\sx\s\d\S*/g)) {
        const allDimensions = dimensionsString.match(/\d\S*\sx\s\d\S*\sx\s\d\S*/g)[0].replace(/[a-z]/g, ' ').replace(/,/g, '.');
        row.height = [{ text: `${Number(allDimensions.match(/\d\S*/g)[2])}` }];
        row.width = [{ text: `${Number(allDimensions.match(/\d\S*/g)[0])}` }];
        row.length = [{ text: `${Number(allDimensions.match(/\d\S*/g)[1])}` }];
        return text;
      }

      if (dimensionsString.includes('width') || dimensionsString.includes('height') || dimensionsString.includes('length')) {
        const height = dimensionsString.match(/(?<=height)(.*?)(?=cm)/g);
        if (height) row.height = [{ text: `${Number(height[0].replace(/[a-z]/g, ' ').replace(/,/g, '.').match(/\d\S*/g)[0])}` }];
        const width = dimensionsString.match(/(?<=width)(.*?)(?=cm)/g);
        if (width) row.width = [{ text: `${Number(width[0].replace(/[a-z]/g, ' ').replace(/,/g, '.').match(/\d\S*/g)[0])}` }];
        const length = dimensionsString.match(/(?<=length)(.*?)(?=cm)/g);
        if (length) row.length = [{ text: `${Number(length[0].replace(/[a-z]/g, ' ').replace(/,/g, '.').match(/\d\S*/g)[0])}` }];
        const depth = dimensionsString.match(/(?<=depth)(.*?)(?=cm)/g);
        if (depth) row.depth = [{ text: `${Number(depth[0].replace(/[a-z]/g, ' ').replace(/,/g, '.').match(/\d\S*/g)[0])}` }];
        return text;
      }

      if (dimensionsString.match(/h\s\d\S*\sx\sw\s\d\S*\sx\sd\s\d\S*/g)
        || dimensionsString.match(/h\s\d\S*\sw\s\d\S*\sd\s\d\S*/g)
        || dimensionsString.match(/h\d\S*\sx\sw\d\S*\sx\sd\d\S*/g)) {
        const allDimensionsRegex = dimensionsString.match(/h\s\d\S*\sx\sw\s\d\S*\sx\sd\s\d\S*/g)
          || dimensionsString.match(/h\s\d\S*\sw\s\d\S*\sd\s\d\S*/g)
          || dimensionsString.match(/h\d\S*\sx\sw\d\S*\sx\sd\d\S*/g);

        const allDimensions = allDimensionsRegex[0].replace(/[a-z]/g, ' ').replace(/,/g, '.');
        row.height = [{ text: `${Number(allDimensions.match(/\d\S*/g)[0])}` }];
        row.width = [{ text: `${Number(allDimensions.match(/\d\S*/g)[1])}` }];
        row.depth = [{ text: `${Number(allDimensions.match(/\d\S*/g)[2])}` }];
        return text;
      }

      if (dimensionsString.match(/\d\S*x\d\S*x\d\S*/g)) {
        const allDimensions = dimensionsString.match(/\d\S*x\d\S*x\d\S*/g)[0].replace(/[a-z]/g, ' ').replace(/,/g, '.');
        row.height = [{ text: `${Number(allDimensions.match(/\d\S*/g)[2])}` }];
        row.width = [{ text: `${Number(allDimensions.match(/\d\S*/g)[0])}` }];
        row.length = [{ text: `${Number(allDimensions.match(/\d\S*/g)[1])}` }];
        return text;
      }

      if (dimensionsString.match(/\d\S*\*\d\S*\*\d\S*/g)) {
        const allDimensions = dimensionsString.match(/\d\S*\*\d\S*\*\d\S*/g)[0].replace(/[a-z*]/g, ' ').replace(/,/g, '.');
        row.height = [{ text: `${Number(allDimensions.match(/\d\S*/g)[2])}` }];
        row.width = [{ text: `${Number(allDimensions.match(/\d\S*/g)[0])}` }];
        row.length = [{ text: `${Number(allDimensions.match(/\d\S*/g)[1])}` }];
        return text;
      }

      if (dimensionsString.match(/\d\S*\s\*\s\d\S*\s\*\s\d\S*/g)) {
        const allDimensions = dimensionsString.match(/\d\S*\s\*\s\d\S*\s\*\s\d\S*/g)[0].replace(/[a-z*]/g, ' ').replace(/,/g, '.');
        row.height = [{ text: `${Number(allDimensions.match(/\d\S*/g)[2])}` }];
        row.width = [{ text: `${Number(allDimensions.match(/\d\S*/g)[0])}` }];
        row.length = [{ text: `${Number(allDimensions.match(/\d\S*/g)[1])}` }];
        return text;
      }

      if (dimensionsString.match(/l\d\S*xw\d\S*xd\d\S*/g)) {
        const allDimensions = dimensionsString.match(/l\d\S*xw\d\S*xd\d\S*/g)[0].replace(/[a-z*]/g, ' ').replace(/,/g, '.');
        row.depth = [{ text: `${Number(allDimensions.match(/\d\S*/g)[2])}` }];
        row.width = [{ text: `${Number(allDimensions.match(/\d\S*/g)[1])}` }];
        row.length = [{ text: `${Number(allDimensions.match(/\d\S*/g)[0])}` }];
        return text;
      }

      if (dimensionsString.match(/w\d\S*\sx\sl\d\S*\sx\sd\d\S*/g)
        || dimensionsString.match(/w\s\d\S*\sx\sl\s\d\S*\sx\sd\s\d\S*/g)) {
        const allDimensionsRegex = dimensionsString.match(/w\d\S*\sx\sl\d\S*\sx\sd\d\S*/g)
          || dimensionsString.match(/w\s\d\S*\sx\sl\s\d\S*\sx\sd\s\d\S*/g);
        const allDimensions = allDimensionsRegex[0].replace(/[a-z]/g, ' ').replace(/,/g, '.');
        row.depth = [{ text: `${Number(allDimensions.match(/\d\S*/g)[2])}` }];
        row.width = [{ text: `${Number(allDimensions.match(/\d\S*/g)[0])}` }];
        row.length = [{ text: `${Number(allDimensions.match(/\d\S*/g)[1])}` }];
        return text;
      }

      if (dimensionsString.match(/h\s\d\S*\sx\sw\s\d\S*/g)
        || dimensionsString.match(/h\d\S*\sx\sw\d\S*/g)) {
        const allDimensionsRegex = dimensionsString.match(/h\s\d\S*\sx\sw\s\d\S*/g)
          || dimensionsString.match(/h\d\S*\sx\sw\d\S*/g);
        const allDimensions = allDimensionsRegex[0].replace(/[a-z]/g, ' ').replace(/,/g, '.');
        row.height = [{ text: `${Number(allDimensions.match(/\d\S*/g)[0])}` }];
        row.width = [{ text: `${Number(allDimensions.match(/\d\S*/g)[1])}` }];
        return text;
      }

      if (dimensionsString.match(/\d\S*x\d\S*\s\d\S*/g)) {
        const allDimensions = dimensionsString.match(/\d\S*x\d\S*/g);
        if (allDimensions[0].includes('"')) {
          row.height = [{ text: `${Number(allDimensions[1].replace(/[a-z]/g, ' ').replace(/,/g, '.').match(/\d\S*/g)[0])}` }];
          row.width = [{ text: `${Number(allDimensions[1].replace(/[a-z]/g, ' ').replace(/,/g, '.').match(/\d\S*/g)[1])}` }];
          return text;
        }
        row.height = [{ text: `${Number(allDimensions[0].replace(/[a-z]/g, ' ').replace(/,/g, '.').match(/\d\S*/g)[0])}` }];
        row.width = [{ text: `${Number(allDimensions[0].replace(/[a-z]/g, ' ').replace(/,/g, '.').match(/\d\S*/g)[1])}` }];
        return text;
      }

      if (dimensionsString.match(/\d\S*x\d\S*/g)) {
        const allDimensions = dimensionsString.match(/\d\S*x\d\S*/g);
        if (allDimensions[0].includes('"')) {
          row.width = [{ text: `${Number(allDimensions[1].replace(/[a-z]/g, ' ').replace(/,/g, '.').match(/\d\S*/g)[0])}` }];
          row.length = [{ text: `${Number(allDimensions[1].replace(/[a-z]/g, ' ').replace(/,/g, '.').match(/\d\S*/g)[1])}` }];
          return text;
        }
        row.width = [{ text: `${Number(allDimensions[0].replace(/[a-z]/g, ' ').replace(/,/g, '.').match(/\d\S*/g)[0])}` }];
        row.length = [{ text: `${Number(allDimensions[0].replace(/[a-z]/g, ' ').replace(/,/g, '.').match(/\d\S*/g)[1])}` }];
        return text;
      }

      if (dimensionsString.match(/\d\S*\sx\s\d\S*/g)) {
        const allDimensions = dimensionsString.match(/\d\S*\sx\s\d\S*/g);
        if (allDimensions[0].includes('"')) {
          row.height = [{ text: `${Number(allDimensions[1].replace(/[a-z]/g, ' ').replace(/,/g, '.').match(/\d\S*/g)[1])}` }];
          row.width = [{ text: `${Number(allDimensions[1].replace(/[a-z]/g, ' ').replace(/,/g, '.').match(/\d\S*/g)[0])}` }];
        } else {
          row.height = [{ text: `${Number(allDimensions[0].replace(/[a-z]/g, ' ').replace(/,/g, '.').match(/\d\S*/g)[1])}` }];
          row.width = [{ text: `${Number(allDimensions[0].replace(/[a-z]/g, ' ').replace(/,/g, '.').match(/\d\S*/g)[0])}` }];
        }

        return text;
      }

      if (dimensionsString.match(/\d\S*cm/g)) {
        const allDimensions = dimensionsString.match(/\d\S*cm/g)[0].replace(/[a-z]/g, ' ').replace(/,/g, '.').replace(/-/g, '');
        row.length = [{ text: `${Number(allDimensions.match(/\d\S*/g)[0])}` }];
        return text;
      }

      return text;
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
