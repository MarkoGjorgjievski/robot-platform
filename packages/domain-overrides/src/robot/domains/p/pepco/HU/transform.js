/* eslint-disable consistent-return */
/* eslint-disable array-callback-return */
/* eslint-disable no-param-reassign */
/* eslint-disable linebreak-style */
/**
 *
 * @param {ImportIO.Group[]} data
 * @returns {ImportIO.Group[]}
 */

const cleanUp = (data) => {
  const mapping = {
    listing_id: (text, row) => {
      const { colour, materials } = row;
      if (colour) {
        const colours = colour[0].text.replace(/\n/g, '').toLowerCase().match(/(?<=szín: )(.*)/g)[0].split(',');
        const colourArray = [];
        colours.map((oneColour) => {
          colourArray.push({ text: oneColour.trim() });
        });
        row.colour = colourArray;
      }

      if (materials) {
        const materialsSeparate = materials[0].text.replace(/\n/g, '').toLowerCase().match(/(?<=anyag: )(.*)/g)[0].split(',');
        const materialsArray = [];
        materialsSeparate.map((material) => {
          materialsArray.push({ text: material.trim() });
        });
        row.materials = materialsArray;
      }

      if (row.product_title && row.product_title?.[0].text.match(/\d+\sdarabos/g)) {
        row.pack_size = [{ text: `${row.product_title?.[0].text.match(/(\d+)(?=\sdarabos)/g)[0]}` }];
      } else {
        row.pack_size = [{ text: '1' }];
      }

      row.stock_availability = [{ text: false }];

      return text.match(/(?<=SKU\/PLU:\s)(.*)/g)[0];
    },
    volume: (text, row) => {
      const volumeValue = text.replace(/\n/g, '').toLowerCase().match(/(?<=űrtartalom:)(.*)/g)[0];
      if (volumeValue.includes('ø')) return;
      const height = text.replace(/\n/g, '').toLowerCase().match(/(?<=magasság)/g);
      row.product_details = [{ text: `capacity: ${volumeValue}` }];

      if (height && !row.height) {
        row.height = [{ text: height.replace(/[a-z]/g, '').match(/\d\S*/g)[0] }];
      }

      row.weight_unit = [{ text: `${volumeValue.match(/[a-zA-Z]+/g)[0]}` }];
      return volumeValue.replace(/[a-zA-z]/g, '').match(/\d\S*/)[0];
    },
    capacity: (text, row) => {
      row.product_details = [{ text: `capacity: ${text}` }];
      return text;
    },
    fieldSize: (text, row) => {
      const textToRetrieve = text.replace(/\n/g, '').toLowerCase();
      if (!textToRetrieve.match(/\d\S*/g)) return text;
      const diameter = text.replace(/\n/g, '').includes('ø');

      if (diameter && text.match(/\d\S*/g).length > 1) {
        row.diameter = [{ text: `${textToRetrieve.replace(/[a-z]/g, ' ').match(/\d\S*/g)[0]}` }];
        row.height = [{ text: `${textToRetrieve.replace(/[a-z]/g, ' ').match(/\d\S*/g)[1]}` }];
        return text;
      }

      if (diameter) {
        row.diameter = [{ text: `${textToRetrieve.replace(/[a-z]/g, ' ').match(/\d\S*/g)[0]}` }];
        return text;
      }

      row.length = [{ text: `${textToRetrieve.replace(/[a-z]/g, ' ').match(/\d\S*/g)[0]}` }];
      return text;
    },
    fieldSizes: (text, row) => {
      const textToRetrieve = text.replace(/\n/g, '').toLowerCase();
      if (!textToRetrieve.match(/\d\S*/g)) return text;
      const threeDimensionsX = textToRetrieve.match(/\d\S*x\d\S*x\d\S*/g) || textToRetrieve.match(/\d\S*\sx\s\d\S*\sx\s\d\S*/g);
      if (threeDimensionsX) {
        row.length = [{ text: `${threeDimensionsX[0].replace(/[a-z]/g, ' ').match(/\d\S*/g)[1]}` }];
        row.width = [{ text: `${threeDimensionsX[0].replace(/[a-z]/g, ' ').match(/\d\S*/g)[0]}` }];
        row.height = [{ text: `${threeDimensionsX[0].replace(/[a-z]/g, ' ').match(/\d\S*/g)[2]}` }];
        return text;
      }

      const twoDimensionsX = textToRetrieve.match(/\d\S*x\d\S*/g) || textToRetrieve.match(/\d\S*\sx\s\d\S*/g);
      if (twoDimensionsX) {
        row.length = [{ text: `${twoDimensionsX[0].replace(/[a-z]/g, ' ').match(/\d\S*/g)[1]}` }];
        row.width = [{ text: `${twoDimensionsX[0].replace(/[a-z]/g, ' ').match(/\d\S*/g)[0]}` }];
        return text;
      }

      const twoDimensionsDiameter = textToRetrieve.includes('átmérő') && textToRetrieve.includes('magasság');
      if (twoDimensionsDiameter) {
        row.diameter = [{ text: `${textToRetrieve.match(/(?<=átmérő)(.*)/g)[0].replace(/[a-z]/g, ' ').match(/\d\S*/g)[0]}` }];
        row.height = [{ text: `${textToRetrieve.match(/(?<=magasság)(.*)/g)[0].replace(/[a-z]/g, ' ').match(/\d\S*/g)[0]}` }];
        return text;
      }

      const diameter = textToRetrieve.includes('ø');
      const hight = textToRetrieve.includes('mag');
      if (diameter && hight) {
        row.diameter = [{ text: `${textToRetrieve.match(/(?<=ø)(.*)/g)[0].replace(/[a-z-]/g, ' ').match(/\d\S*/g)[0]}` }];
        row.height = [{ text: `${textToRetrieve.match(/(?<=mag)(.*)/g)[0].replace(/[a-z-]/g, ' ').match(/\d\S*/g)[0]}` }];
        return text;
      }

      row.length = [{ text: `${textToRetrieve.replace(/[a-z]/g, ' ').match(/\d\S*/g)[0]}` }];
      return text;
    },
    hightField: (text, row) => {
      if (row.fieldSizes && row.fieldSizes?.[0]?.text.replace(/\n/g, '').match(/\d\S*/g)) return;

      const textToRetrieve = text.replace(/\n/g, '').toLowerCase();
      const diameter = text.replace(/\n/g, '').includes('ø');

      if (diameter && text.match(/\d\S*/g).length > 1) {
        row.diameter = [{ text: `${textToRetrieve.replace(/[a-z]/g, ' ').match(/\d\S*/g)[0]}` }];
        row.height = [{ text: `${textToRetrieve.replace(/[a-z]/g, ' ').match(/\d\S*/g)[1]}` }];
        return text;
      }

      row.hight = [{ text: `${textToRetrieve.replace(/[a-z]/g, ' ').match(/\d\S*/g)[0]}` }];
      return text;
    },
    diameter: (text, row) => {
      if (row.fieldSizes && row.fieldSizes?.[0]?.text.replace(/\n/g, '').match(/\d\S*/g)) return text;
      return text.replace(/\n/g, '').toLowerCase().match(/(?<=átmérő: )(.*)/g)[0].replace(/[a-z]/g, ' ').match(/\d\S*/g)[0];
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
