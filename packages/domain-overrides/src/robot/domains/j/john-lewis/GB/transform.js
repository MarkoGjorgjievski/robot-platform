/* eslint-disable consistent-return */
/**
 *
 * @param {ImportIO.Group[]} data
 * @returns {ImportIO.Group[]}
 */
const cleanUp = (data) => {
  const extractDimensionValue = (text, dimensionName) => {
    if (!text) return null;

    const caseInsensitive = 'i';
    const dimensionRegex = new RegExp(`${dimensionName}(\\d+(\\.\\d+)?)\\s*(cm)?\\s*`, caseInsensitive);
    const matchDimensions = text.match(dimensionRegex);

    if (matchDimensions && matchDimensions[1]) {
      return matchDimensions[1];
    }

    const pattern = /(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)(cm)?/;
    const match = pattern.exec(text);

    if (match) {
      const dimensions = {
        H: match[1],
        W: match[2],
        D: match[3],
      };

      return dimensions[dimensionName] ? dimensions[dimensionName] : null;
    }

    const regexPattern = /(\d+(?:,\d+)?)\s*x\s*(\d+(?:\.\d+)?)\s*([^\dx]+)(cm)?/g;
    const matches = text.match(regexPattern);

    if (matches) {
      const dimensionsArray = matches[0].split('x');
      if (dimensionName === 'H' && dimensionsArray[0]) return dimensionsArray[0].match(/[\d.,]+/)[0];
      if (dimensionName === 'W' && dimensionsArray[1]) return dimensionsArray[1].match(/[\d.,]+/)[0];
      if (dimensionName === 'D' && dimensionsArray[2]) return dimensionsArray[2].match(/[\d.,]+/)[0];
    }

    return null;
  };

  const mapping = {
    alternative_images: text => `https:${text}`,
    height: text => extractDimensionValue(text, 'H'),
    width: (text) => {
      const regex = /width: (\d+[,.]?\d+)/;
      const match = text.match(regex);
      if (match) {
        return match[1];
      }
      return extractDimensionValue(text, 'W');
    },
    depth: (text) => {
      const regex = /D(\d+[,.]?\d+)/;
      const match = text.match(regex);
      if (match) {
        return match[1];
      }
      return extractDimensionValue(text, 'D');
    },
    diameter: (text) => {
      const regex = /Dia?.(\d+[,.]?\d+)/;
      const match = text.match(regex);
      if (match) {
        return match[1];
      }
      return extractDimensionValue(text, 'Dia');
    },
    length: (text) => {
      const regex = /length: (\d+[,.]?\d+)/;
      const match = text.match(regex);
      if (match) {
        return match[1];
      }
      return extractDimensionValue(text, 'L');
    },
    weight_raw: text => (!/\d/.test(text.charAt(text.length - 1)) ? text.slice(0, -1) : text),
    dimensions_unit: text => (text === 'cm' || text === 'mm' ? text : 'cm'),
  };

  const mappingFct = (header, arr, row) => [...arr.map(({ text, ...other }) => ({ text: mapping[header](text, row), ...other }))];

  data.forEach(obj => obj.group.forEach(row => Object.keys(row).forEach((header) => {
    // eslint-disable-next-line no-param-reassign
    if (mapping[header]) row[header] = mappingFct(header, row[header], row);
  })));
  return data;
};

module.exports = { cleanUp };
