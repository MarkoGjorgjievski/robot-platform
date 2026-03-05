/**
 *
 * @param {ImportIO.Group[]} data
 * @returns {ImportIO.Group[]}
 */
const cleanUp = (data) => {
  const normalizeSize = (measurement) => {
    if (measurement) {
      const unit = measurement.match(/\d\s*(cm|mm|m)/)?.[1];
      const value = Number(measurement.replace(',', '.').match(/([\d.]+)/)?.[1]);
      if (Number.isNaN(value)) { return null; }
      switch (unit) {
        case 'mm':
          return String(value / 10);
        case 'm':
          return String(value * 100);
        case 'cm':
        default:
          return String(value);
      }
    }
    return null;
  };
  const resolveBackup = (text, backup) => {
    if (text === 'null') {
      if (backup) {
        return backup;
      }
      return null;
    }
    return text;
  };

  const mapping = {
    diameter: (text, row) => normalizeSize(resolveBackup(text, row.diameter_backup?.[0]?.text)),
    width: (text, row) => normalizeSize(resolveBackup(text, row.width_backup?.[0]?.text)),
    height: (text, row) => normalizeSize(resolveBackup(text, row.height_backup?.[0]?.text)),
    length: (text, row) => normalizeSize(resolveBackup(text, resolveBackup(row.length_backup?.[0]?.text, row.length_backup2?.[0]?.text))),
    original_price: (text, row) => ((row.list_price?.[0]?.text !== row.price?.[0]?.text) ? row.list_price?.[0]?.text : row.price?.[0]?.text),
    offer_price: (text, row) => ((row.list_price?.[0]?.text !== row.price?.[0]?.text) ? row.price?.[0]?.text : null),
    weight_raw: (text, row) => {
      if (row.package_weights) {
        return String(row.package_weights.reduce((sum, weight) => sum + Number(weight.text), 0).toFixed(2));
      }
      return null;
    },
  };

  const mappingFct = (header, arr, row) => arr.map(({ text, ...other }) => {
    if (mapping[header]) {
      // eslint-disable-next-line no-param-reassign
      text = mapping[header](text, row);
    }
    return { text, ...other };
  });

  data.forEach(obj => obj.group.forEach(row => Object.keys(row).forEach((header) => {
    // eslint-disable-next-line no-param-reassign
    if (mapping[header]) row[header] = mappingFct(header, row[header], row);
  })));

  return data;
};

module.exports = { cleanUp };
