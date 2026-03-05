/**
 *
 * @param {ImportIO.Group[]} data
 * @returns {ImportIO.Group[]}
 */
//

const cleanUp = (data) => {
  const mapping = {
    main_image: text => `https:${text}`,
    alternative_images: text => `https:${text}`,
    colour: (text) => {
      const regex = /Farba: (.*)/g;
      const matches = regex.exec(text);
      return matches !== null && matches[1] ? matches[1] : text;
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
