/**
 *
 * @param {ImportIO.Group[]} data
 * @returns {ImportIO.Group[]}
 */
const cleanUp = (data) => {
  const mapping = {
    user_reviews: (text) => {
      const regex = /\((\d+)\)/;
      return text.replace(regex, (match, group1) => group1);
    },
    dimensions_unit: text => text.replace(/[^a-zA-Z]/g, ''),
    weight_unit: text => text.split(' ').pop(),
    materials: text => text.replace(/\n/g, ''),
    colour: (text) => {
      const words = text.trim().split(' ');
      if (words.length < 2) return null;
      const lastWord = words.pop();
      if (lastWord.match(/\d/) || lastWord.length < 2) return null;
      return lastWord.replace(/,$/, '');
    },
    // pack_size: (text, row) => {
    //   if (text === 'null') {
    //     return row.pack_size_backup?.[0]?.text ?? null;
    //   }
    //   return text;
    // },
    height: text => (text !== '0' ? text : null),
    width: text => (text !== '0' ? text : null),
    length: text => (text !== '0' ? text : null),
    depth: text => (text !== '0' ? text : null),
  };

  const mappingFct = (header, arr, row) => [...arr.map(({ text, ...other }) => ({ text: mapping[header](text, row), ...other }))];

  data.forEach(obj => obj.group.forEach(row => Object.keys(row).forEach((header) => {
    // eslint-disable-next-line no-param-reassign
    if (mapping[header]) row[header] = mappingFct(header, row[header], row);
  })));
  return data;
};

module.exports = { cleanUp };
