/* eslint-disable no-param-reassign */
/**
 *
 * @param {ImportIO.Group[]} data
 * @returns {ImportIO.Group[]}
 */
//
const cleanUp = (data) => {
  let materialsIndex = 0;
  const mapping = {
    listing_id: text => (text ? text.split('.').join('') : null),
    original_price: (text, row) => (text === '-1' ? row.offer_price[0].text : text),
    colour: (text) => {
      const colour = text ? text.split(', ') : null;
      return colour.length > 1 ? colour[1].replace(',', '') : null;
    },
    materialsLeft: (text, row) => {
      if (text) {
        row.materials = row.materials ? [...row.materials, { text: `${text}: ${row.materialsRight[materialsIndex].text}` }] : [{ text: `${text}: ${row.materialsRight[materialsIndex].text}` }];
        materialsIndex += 1;
      }
      return text;
    },
  };

  const mappingFct = (header, arr, row) => [
    ...arr.map(({ text, ...other }) => ({
      text: mapping[header](text, row),
      ...other,
    })),
  ];
  data.forEach(obj => obj.group.forEach(row => Object.keys(row).forEach((header) => {
    // eslint-disable-next-line no-param-reassign
    if (mapping[header]) row[header] = mappingFct(header, row[header], row);
  })));
  return data;
};
module.exports = { cleanUp };
