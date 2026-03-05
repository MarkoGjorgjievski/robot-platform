/* eslint-disable linebreak-style */
/* eslint-disable no-unused-expressions */
/* eslint-disable consistent-return */
/* eslint-disable no-param-reassign */
/* eslint-disable linebreak-style */
/**
 *
 * @param {ImportIO.Group[]} data
 * @returns {ImportIO.Group[]}
 */
const cleanUp = (data) => {
  const replaceNonDigits = text => text.replace(/\D/g, '');

  const mapping = {
    productURL: text => `https://www.structube.com/${text}`,
    product_variations_link: (text, row) => {
      // Modify url to get rid of the last index
      const modifiedUrl = text.replace(/=[^=&]+$/, '=');

      // Get the indexes from script tag
      const match = /tag:\s*["']([^"']+)["']/i.exec(row.product_variations_index?.[0]?.text);
      const tagValue = match ? match?.[1] : null;
      const indexArray = tagValue ? tagValue.split(',').slice(2) : null;
      if (!indexArray || indexArray.length <= 1) return;
      const variationsArray = [];

      // Concatenate url and index
      for (let i = 1; i < indexArray.length; i += 1) {
        variationsArray.push({ text: modifiedUrl + indexArray[i] });
      }
      row.product_variations = variationsArray;
    },
    user_reviews: replaceNonDigits,
    main_image: text => `https://www.structube.com/${text}`,
    alternative_images: text => `https://www.structube.com/${text}`,
    original_price: replaceNonDigits,
    offer_price: (text, row) => {
      if (row.original_price?.[0]?.text) {
        return text;
      }
      row.original_price = [{ text }];
    },
    dimensions_data: (text, row) => {
      const widthRegex = /Width: (\d+(\.\d+)?|\d+,\d+) cm/;
      const heightRegex = /Height: (\d+(\.\d+)?|\d+,\d+) cm/;
      const depthRegex = /Depth: (\d+(\.\d+)?|\d+,\d+) cm/;

      const widthMatch = text.match(widthRegex);
      const heightMatch = text.match(heightRegex);
      const depthMatch = text.match(depthRegex);

      heightMatch ? row.height.unshift({ text: heightMatch[1] }) : row.height = [{ text: null }];
      widthMatch ? row.width.unshift({ text: widthMatch[1] }) : row.width = [{ text: null }];
      depthMatch ? row.depth.unshift({ text: depthMatch[1] }) : row.depth = [{ text: null }];
    },
    height: text => (text === 'dummy' || !text ? null : text),
    width: text => (text === 'dummy' || !text ? null : text),
    depth: text => (text === 'dummy' || !text ? null : text),
    weight_raw: (text) => {
      const weightRegex = /Weight: (\d+(\.\d+)?|\d+,\d+) kg/;
      const weightMatch = text.match(weightRegex);
      return weightMatch ? weightMatch[1] : null;
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
