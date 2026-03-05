/* eslint-disable no-param-reassign
*/
/**
 *
 * @param {ImportIO.Group[]} data
 * @returns {ImportIO.Group[]}
 */

const cleanUp = (data) => {
  const mapping = {
    dimension_tittle: (text, row) => {
      if (!row.dimension_tmp) {
        const width = text.match(/(?<=x )((\d+.\d+)|(\d+))(?= x)/g)?.[0];
        const height = text.match(/(?<=x )((\d+.\d+)|(\d+))(?= cm)/g)?.[0];
        const length = text.match(/((?<=\| )((\d+.\d+)|(\d+))(?= x)|^((\d+.\d+)|(\d+))(?= x))/g)?.[0];
        const diameter = text.match(/(?<=Ø )((\d+.\d+)|(\d+))/g)?.[0];

        if (height !== undefined) row.height = [{ text: `${height}` }];
        if (width !== undefined) row.width = [{ text: `${width}` }];
        if (length !== undefined) row.length = [{ text: `${length}` }];
        if (diameter !== undefined) row.diameter = [{ text: `${diameter}` }];
      }
      return text;
    },
    dimension_tmp: (text, row) => {
      const width = text.match(/(?<=x )((\d+.\d+)|(\d+))(?= x)/g)?.[0];
      const height = text.match(/(?<=x )((\d+.\d+)|(\d+))(?= cm)/g)?.[0];
      const length = text.match(/^((\d+.\d+)|(\d+))(?= x)/g)?.[0];
      const diameter = text.match(/(?<=Ø )((\d+.\d+)|(\d+))/g)?.[0];

      if (height !== undefined) row.height = [{ text: `${height}` }];
      if (width !== undefined) row.width = [{ text: `${width}` }];
      if (length !== undefined) row.length = [{ text: `${length}` }];
      if (diameter !== undefined) row.diameter = [{ text: `${diameter}` }];

      return text;
    },
    description: (text) => {
      text = text.replace(/\n/g, ' ');
      return text;
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
