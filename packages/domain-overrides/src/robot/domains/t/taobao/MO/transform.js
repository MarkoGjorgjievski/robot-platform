/**
 *
 * @param {ImportIO.Group[]} data
 * @returns {ImportIO.Group[]}
 */
const cleanUp = (data) => {
  const normalizeSize = (measurement) => {
    const unit = measurement.match(/\d\s*(cm|mm|m)/)?.[1];
    let value = Number(measurement.match(/([\d.]+)/)?.[1]);
    if (Number.isNaN(value)) { return null; }
    switch (unit) {
      case 'mm':
        value /= 10;
        break;
      case 'm':
        value *= 100;
        break;
      case 'cm':
      default:
        break;
    }
    // round to 2 decimal places
    value = Math.round((value + Number.EPSILON) * 100) / 100;
    return String(value);
  };
  const extractDimension = (text, index) => {
    const values = text.split(/[*xX]/);
    if (values[index]) {
      return normalizeSize(values[index]);
    }
    return null;
  };

  const mapping = {
    length: (text, row) => {
      if (text === 'null') {
        if (row.dimensions_raw) {
          return extractDimension(row.dimensions_raw?.[0]?.text, 0);
        }
        return null;
      }
      return normalizeSize(text);
    },
    width: (text, row) => {
      if (text === 'null') {
        if (row.dimensions_raw) {
          return extractDimension(row.dimensions_raw?.[0]?.text, 1);
        }
        return null;
      }
      return normalizeSize(text);
    },
    height: (text, row) => {
      if (text === 'null') {
        if (row.dimensions_raw) {
          return extractDimension(row.dimensions_raw?.[0]?.text, 2);
        }
        return null;
      }
      return normalizeSize(text);
    },

    // increaseimage resolution
    main_image: text => text.replace(/100x100/, '500x500'),
    alternative_images: text => text.replace(/100x100/, '500x500'),
    // remove quotes and  brackets
    colour: text => text.match(/([\u4E00-\u9FFF]*[粉红橙黄绿蓝紫蓝白灰褐黑棕咖棕金银][\u4E00-\u9FFF]*)/)?.[1]?.replace(/[【】『』]/g, '') ?? null,
  };

  const mappingFct = (header, arr, row) => [...arr.map(({ text, ...other }) => ({ text: mapping[header](text, row), ...other }))];

  data.forEach(obj => obj.group.forEach(row => Object.keys(row).forEach((header) => {
    // eslint-disable-next-line no-param-reassign
    if (mapping[header]) row[header] = mappingFct(header, row[header], row);
  })));
  return data;
};

module.exports = { cleanUp };
