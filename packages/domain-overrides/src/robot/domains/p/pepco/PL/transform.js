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
    product_title: (text, row) => {
      const { colour, materials } = row;
      if (colour) {
        const colours = colour[0].text.replace(/\n/g, '').match(/(?<=KOLOR: )(.*)/g)[0].split(',');
        const colourArray = [];
        colours.map((oneColour) => {
          colourArray.push({ text: oneColour.trim() });
        });
        row.colour = colourArray;
      }

      if (materials) {
        const materialsSeparate = materials[0].text.replace(/\n/g, '').match(/(?<=MATERIAŁ: )(.*)/g)[0].split(',');
        const materialsArray = [];
        materialsSeparate.map((material) => {
          materialsArray.push({ text: material.trim() });
        });
        row.materials = materialsArray;
      }

      row.stock_availability = [{ text: false }];

      return text;
    },
    description: (text, row) => {
      if (text.match(/(?<=Zestaw )(\d+)/g)) {
        row.pack_size = [{ text: `${text.match(/(?<=Zestaw )(\d+)/g)[0]}` }];
      } else if (text.match(/(?<=Komplet )(\d+)/g)) {
        row.pack_size = [{ text: `${text.match(/(?<=Komplet )(\d+)/g)[0]}` }];
      } else if (text.match(/\d+\sszt|\d+szt/g)) {
        row.pack_size = [{ text: `${text.match(/(\d+)(?=\sszt)|(\d+)(?=szt)/g)[0]}` }];
      } else if (text.match(/\d+\W\spak/g)) {
        row.pack_size = [{ text: `${text.match(/(\d+)(?=\W\spak)/g)[0]}` }];
      } else {
        row.pack_size = [{ text: '1' }];
      }
      return text;
    },
    dimensionsField: (text, row) => {
      const textDot = text.replace(/,/g, '.').replace(/\n/g, '');

      if (textDot.match(/\d\S*(?: x )\d\S*(?: x )\d\S*/g) || textDot.match(/\d\S*(?: cm x )\d\S*(?: cm x )\d\S*/g)) {
        const allDimensions = textDot.replace(/cm/g, '').replace(/x/g, ' ');
        row.height = [{ text: `${Number(allDimensions.match(/\d\S*/g)[2])}` }];
        row.width = [{ text: `${Number(allDimensions.match(/\d\S*/g)[0])}` }];
        row.length = [{ text: `${Number(allDimensions.match(/\d\S*/g)[1])}` }];
        return text;
      }

      if (textDot.match(/średnica\s\d\S*\scm\sx\swysokość\s\d\S*/g)
        || textDot.match(/śr.\s\d\S*\scm,\swys.\s\d\S*/g)
        || textDot.match(/średnica\s\d\S*\scm\sx\s\d\S*/g)
        || textDot.match(/\d\S*\scm.\swys.\s\d\S*/g)
        || textDot.match(/\d\S*\scm.\swysokość \s\d\S*/g)
        || textDot.match(/D:\s\d\S*\scm\sx\sH:\s\d\S*/)) {
        const allDimensions = textDot.replace(/[a-zA-Zś]/g, '');
        row.height = [{ text: `${Number(allDimensions.match(/\d\S*/g)[1])}` }];
        row.diameter = [{ text: `${Number(allDimensions.match(/\d\S*/g)[0])}` }];
        return text;
      }

      if (textDot.match(/\d\S*\sx\s\d\S*/g)
        || textDot.match(/\d\S*\scm\sx\s\d\S*/g)) {
        const allDimensions = textDot.replace(/[a-zA-Zś]/g, '');

        row.width = [{ text: `${Number(allDimensions.match(/\d\S*/g)[0])}` }];
        if (row.product_title?.[0].text.toLowerCase().includes('ręczni')
          || row.product_title?.[0].text.toLowerCase().includes('koc')
          || row.product_title?.[0].text.toLowerCase().includes('dywan')
          || row.product_title?.[0].text.toLowerCase().includes('obrus')
          || row.product_title?.[0].text.toLowerCase().includes('pled')
          || row.product_title?.[0].text.toLowerCase().includes('bieżnik')
          || row.product_title?.[0].text.toLowerCase().includes('narzuta')
          || row.product_title?.[0].text.toLowerCase().includes('mata')) {
          row.length = [{ text: `${Number(allDimensions.match(/\d\S*/g)[1])}` }];
          return text;
        }

        row.height = [{ text: `${Number(allDimensions.match(/\d\S*/g)[1])}` }];
        return text;
      }

      if (textDot.match(/\d\S*/g)) {
        row.height = [{ text: `${Number(textDot.match(/\d\S*/g)[0])}` }];
        return text;
      }

      return text;
    },
    hightField: (text, row) => {
      if (text.match(/śr.\s\d\S*\scm,\swys.\s\d\S*/)) {
        const allDimensions = text.replace(/[a-zA-Zś]/g, ' ');
        row.height = [{ text: `${Number(allDimensions.replace(/,/g, '.').match(/\d\S*/g)[1])}` }];
        row.diameter = [{ text: `${Number(allDimensions.replace(/,/g, '.').match(/\d\S*/g)[0])}` }];
        return text;
      }

      if (text.match(/\d\S*\scm/g)) {
        row.height = [{ text: `${Number(text.replace(/,/g, '.').match(/\d\S*/g)[0])}` }];
        return text;
      }

      return text;
    },
    volume: (text, row) => {
      const volumeValue = text.replace(/\n/g, '').match(/(?<=POJEMNOŚĆ: )(.*)/g)[0].match(/\d(.*)/g)[0];
      row.product_details = [{ text: `capacity: ${volumeValue}` }];

      if (!row.weight_raw) {
        row.weight_unit = [{ text: `${volumeValue.match(/[a-zA-Z]+/g)[0]}` }];
        return volumeValue.replace(/[a-zA-z]/g, '').match(/\d\S*/)[0];
      }
      return volumeValue.replace(/[a-zA-z]/g, '').match(/\d\S*/)[0];
    },
    diameter: text => text.replace(/\n/g, '').match(/(?<=ŚREDNICA: )(.*)/g)[0].match(/\d\S*/g)[0],
    sizeField: (text, row) => {
      if (text.includes('zł')) return text;
      const textDot = text.replace(/,/g, '.').replace(/\n/g, '');
      if (textDot.match(/\d\S*x\d\S*/g)) {
        const allDimensions = textDot.replace(/[a-zA-Zś]/g, ' ');

        row.width = [{ text: `${Number(allDimensions.match(/\d\S*/g)[0])}` }];
        if (row.product_title?.[0].text.toLowerCase().includes('ręczni')
          || row.product_title?.[0].text.toLowerCase().includes('koc')
          || row.product_title?.[0].text.toLowerCase().includes('dywan')
          || row.product_title?.[0].text.toLowerCase().includes('obrus')
          || row.product_title?.[0].text.toLowerCase().includes('pled')
          || row.product_title?.[0].text.toLowerCase().includes('bieżnik')
          || row.product_title?.[0].text.toLowerCase().includes('narzuta')
          || row.product_title?.[0].text.toLowerCase().includes('mata')) {
          row.length = [{ text: `${Number(allDimensions.match(/\d\S*/g)[1])}` }];
          return text;
        }

        row.height = [{ text: `${Number(allDimensions.match(/\d\S*/g)[1])}` }];

        return text;
      }
      if (textDot.match(/śr.\s\d\S*/g)) {
        const allDimensions = textDot.replace(/[a-zA-Zś]/g, ' ');
        row.diameter = [{ text: `${Number(allDimensions.match(/\d\S*/g)[0])}` }];
        return text;
      }
      if (textDot.match(/A\d\S*/g)) {
        return text;
      }
      if (textDot.match(/\d\S*/g)) {
        const allDimensions = textDot.replace(/[a-zA-Zś]/g, ' ');
        if (row.product_title?.[0].text.toLowerCase().includes('patelnia')
          || row.product_title?.[0].text.toLowerCase().includes('talerz')) {
          row.diameter = [{ text: `${Number(allDimensions.match(/\d\S*/g)[0])}` }];
          return text;
        }
        row.height = [{ text: `${Number(allDimensions.match(/\d\S*/g)[0])}` }];
        return text;
      }
      row.height = [{ text }];
      return text;
    },
    listing_id: (text, row) => text.substring(text.indexOf('offerId') + 7, text.indexOf('}')).replace(row.product_title?.[0]?.text, '').replace(/'/g, '').replace(/\s/g, '')
      .match(/\d\S*/)[0],
  };

  const mappingFct = (header, arr, row) => arr.map(({ text, ...other }) => ({ text: mapping[header](text, row), ...other }));

  data.forEach(obj => obj.group.forEach(row => Object.keys(row).forEach((header) => {
    // eslint-disable-next-line no-param-reassign
    if (mapping[header]) row[header] = mappingFct(header, row[header], row);
  })));

  return data;
};

module.exports = { cleanUp };
