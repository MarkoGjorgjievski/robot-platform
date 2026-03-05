/* eslint-disable no-param-reassign */
/**
 *
 * @param {ImportIO.Group[]} data
 * @returns {ImportIO.Group[]}
 */
const cleanUp = (data) => {
  const dimensions = {
    W: 'width',
    H: 'height',
    D: 'depth',
    L: 'length',
    w: 'width',
    h: 'height',
    d: 'depth',
    l: 'length',
  };

  const dimensionRegex = /([WHLDwhld])?(\d+(\.\d+)?)([WHLDwhld])?/g;
  const getDimensionsNames = (dimensionsDescription) => {
    // dimensionsDescription = "L * W * H"

    const dimensionsDescriptionWithoutSpaces = dimensionsDescription.replace(
      /\s/g,
      '',
    );
    // dimensionsDescription = L*W*H

    const dimensionsArr = dimensionsDescriptionWithoutSpaces.split('*');
    // dimensionsArr = ["L", "W", "H"]

    // dimensionsNames = ["length", "width", "height"]

    return dimensionsArr.map(
      dimension => dimensions[dimension],
    );
  };

  const mapping = {
    dimensionsText: (text, row) => {
      // text = "20.5*17.0*11.0 CM"

      const dimensionsDescriptionRaw = row.dimensionsDescription?.[0].text;

      const dimensionsNames = getDimensionsNames(dimensionsDescriptionRaw);

      const regex = /(\d+(\.\d+)?)/g;

      const dimensionsValues = text.match(regex);
      // dimensionsValues = ["20.5", "17.0", "11.0"]
      dimensionsValues.forEach((value, index) => {
        row[dimensionsNames[index]] = [{ text: value }];
      });
      return text;
    },

    dimensionsDescriptionExtra: (text, row) => {
      if (row?.dimensionsText) return null;
      let matches;
      const dims = {};
      let iterator = 0;
      if (text.includes('cm') || text.includes('CM')) {
        row.dimensions_unit = [{ text: 'cm' }];
      }
      if (text.includes('mm') || text.includes('MM')) {
        row.dimensions_unit = [{ text: 'mm' }];
      }

      // eslint-disable-next-line no-cond-assign
      while ((matches = dimensionRegex.exec(text)) !== null) {
        // matches[1] and matches[4] contain the dimension identifier
        // matches[2] contains the dimension value

        if (matches[1]) {
          dims[matches[1]] = parseFloat(matches[2]);
        } else if (matches[4]) {
          dims[matches[4]] = parseFloat(matches[2]);
        } else {
          // eslint-disable-next-line prefer-destructuring
          dims[iterator] = matches[2];
          iterator += 1;
        }
      }

      Object.keys(dims).forEach((key) => {
        if (Number.isNaN(parseInt(key, 10))) {
          row[dimensions[key]] = [{ text: dims[key].toString() }];
        }
      });

      if (row.height) {
        if (dims[0]) row.length = [{ text: dims[0] }];
        if (dims[1]) row.width = [{ text: dims[1] }];
      } else {
        if (dims[0]) row.length = [{ text: dims[0] }];
        if (dims[1]) row.width = [{ text: dims[1] }];
        if (dims[2]) row.height = [{ text: dims[2] }];
        if (dims[3]) row.depth = [{ text: dims[3] }];
      }
      return text;
    },

    dimensions_unit: text => text.toLowerCase(),

    current_price: (text, row) => {
      const oldPrice = row.old_price?.[0]?.text.replace(/,/g, '');
      const formattedPrice = text.replace(/,/g, '');
      if (oldPrice) {
        row.offer_price = [{ text: formattedPrice }];
        row.original_price = [{ text: oldPrice }];
      } else {
        row.original_price = [{ text: formattedPrice }];
      }
      return text;
    },

    pack_size_from_title: (text, row) => {
      // text = "LUMINARC - SET OF 3 LUNCH BOX SET"
      const regex = /set of (\d+)/i;
      const match = text.match(regex);
      if (match) {
        row.pack_size = [{ text: match[1] }];
      }
      return text;
    },

    weight_unit: text => text.toLowerCase(),

    volume: (text) => {
      const volume = parseFloat(text);
      if (text.includes('ml') || text.includes('ML')) {
        return (volume / 1000).toString();
      }
      return text;
    },
  };

  const mappingFct = (header, arr, row) => arr.map(({ text, ...other }) => ({
    text: mapping[header](text, row),
    ...other,
  }));

  data.forEach(obj => obj.group.forEach(row => Object.keys(row).forEach((header) => {
    // eslint-disable-next-line no-param-reassign
    if (mapping[header]) row[header] = mappingFct(header, row[header], row);
  })));

  return data;
};

module.exports = { cleanUp };
