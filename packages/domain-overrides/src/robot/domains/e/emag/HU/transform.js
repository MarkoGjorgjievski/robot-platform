/* eslint-disable no-param-reassign */
/**
 *
 * @param {ImportIO.Group[]} data
 * @returns {ImportIO.Group[]}
 */
//
const cleanUp = (data) => {
  const mapping = {
    height: (text, row) => {
      if (text !== 'dummy') return text;
      if (row.height_backup) return row.height_backup?.[0]?.text;
      if (row.dimensions_backup) {
        const dimensionsArr = row.dimensions_backup?.[0]?.text.split(/[xX]/);
        return dimensionsArr && dimensionsArr[2] ? dimensionsArr[2].trim() : null;
      }
      if (row.dimensions_from_title) {
        const dimensionsArr = row.dimensions_from_title?.[0]?.text.split(/[xX]/);
        return dimensionsArr && dimensionsArr[2] ? dimensionsArr[2].trim() : null;
      }
      return null;
    },
    width: (text, row) => {
      if (text !== 'dummy') return text;
      if (row.width_backup) return row.width_backup?.[0]?.text;
      if (row.dimensions_backup) {
        const dimensionsArr = row.dimensions_backup?.[0]?.text.split(/[xX]/);
        return dimensionsArr && dimensionsArr[1] ? dimensionsArr[1].trim() : null;
      }
      if (row.dimensions_from_title) {
        const dimensionsArr = row.dimensions_from_title?.[0]?.text.split(/[xX]/);
        return dimensionsArr && dimensionsArr[1] ? dimensionsArr[1].trim() : null;
      }
      return null;
    },
    depth: (text, row) => {
      if (text !== 'dummy') return text;
      if (row.depth_backup) return row.depth_backup?.[0]?.text;
      return null;
    },
    length: (text, row) => {
      if (text !== 'dummy') return text;
      if (row.length_backup) return row.length_backup?.[0]?.text;
      if (row.dimensions_backup) {
        const dimensionsArr = row.dimensions_backup?.[0]?.text.split(/[xX]/);
        return dimensionsArr && dimensionsArr[0] ? dimensionsArr[0].trim() : null;
      }
      if (row.dimensions_from_title) {
        const dimensionsArr = row.dimensions_from_title?.[0]?.text.split(/[xX]/);
        return dimensionsArr && dimensionsArr[0] ? dimensionsArr[0].trim() : null;
      }
      return null;
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
