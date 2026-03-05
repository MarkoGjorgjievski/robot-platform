/**
 *
 * @param {ImportIO.Group[]} data
 * @returns {ImportIO.Group[]}
 */
//

const cleanUp = (data) => {
  const getLabeledValue = (values, labels, labelRegex) => {
    if (values !== undefined && labels !== undefined) {
      const dimensions = values.replace(/[( )]/g, '').split('x');
      const index = labels.replace(/[( )]/g, '').split('x').findIndex(l => labelRegex.test(l));
      // for variable dimensions ie extendable height, choose the biggest one
      const value = dimensions[index]?.split('-')?.map(x => Number(x.replace(/,/g, '')));
      if (value) { return String(Math.max(...value)); }
    }
    return undefined;
  };
  const resolveLabeledDimensions = (text, row, labelRegex) => {
    if (text === 'null') {
      const valueFromDetails = getLabeledValue(row.dimensions_raw?.[0]?.text, row.dimensions_raw_labels?.[0]?.text, labelRegex);
      if (valueFromDetails !== undefined) {
        return valueFromDetails;
      }

      const valueFromDescription = getLabeledValue(row.dimensions_raw_backup?.[0]?.text, row.dimensions_raw_labels_backup?.[0]?.text, labelRegex);
      if (valueFromDescription !== undefined) {
        return valueFromDescription;
      }
      return null;
    }
    return text;
  };

  const resolveUnlabeledDimensions = (text, row, index) => {
    if (text === null && row.dimensions_raw_unlabeled) {
      const values = row.dimensions_raw_unlabeled?.[0]?.text.replace(/[cm ]/g, '').split('x');
      if (values[index]) {
        const number = Number(values[index].replace(',', '.'));
        return number ? String(number) : null;
      }
      return null;
    }
    if (text === null && row.dimensions_raw_unlabeled_backup) {
      const values = row.dimensions_raw_unlabeled_backup?.[0]?.text.replace(/[cm ]/g, '').split('x');
      if (values[index]) {
        const number = Number(values[index].replace(',', '.'));
        return number ? String(number) : null;
      }
      return null;
    }
    return text;
  };

  const mapping = {
    materials: (text, row) => {
      if (text === 'empty') {
        const backup = row.materials_backup?.[0]?.text;
        if (backup) {
          return ((backup.match(/%/g)?.length > 1 || backup.match(/\w+\s\d/)) ? `material: ${backup}` : backup);
        }
        return null;
      }
      return ((text.match(/%/g)?.length > 1 || text.match(/\w+\s\d/)) ? `material: ${text}` : text);
    },
    length: (text, row) => resolveLabeledDimensions(text, row, /^[Ll]/),
    width: (text, row) => resolveLabeledDimensions(text, row, /^[Bb]/),
    height: (text, row) => resolveLabeledDimensions(text, row, /^[Hh]/),
    depth: (text, row) => resolveLabeledDimensions(text, row, /^[Dd]/),
    diameter: (text, row) => resolveLabeledDimensions(text, row, /^[Øø]/),
    average_rating: text => (text.replace(',', '.')),
    original_price: text => ((text === 'N/A') ? '0' : text),
    pack_size: (text, row) => {
      if (text === 'null') {
        return row.pack_size_backup?.[0]?.text || null;
      }
      return text;
    },
    product_details: text => (text.replace(/Toon minder Toon meer/m, '').replace(/[ \n]+/mg, '\n')),
    weight_raw: (text, row) => {
      if (text === 'null') {
        if (row.weight_raw_backup?.[0]?.text !== undefined) {
          const number = Number(row.weight_raw_backup?.[0]?.text.replace(/,/g, '.'));
          return number ? String(number) : null;
        }
        return null;
      }
      return text;
    },
    weight_unit: (text, row) => {
      if (text === 'null') {
        if (row.weight_unit_backup?.[0]?.text !== undefined && row.weight_unit_backup?.[0]?.text.match(/^g.*/)) { return 'g'; }
        return 'kg';
      }
      return text.replace(/^k.*/, 'kg').replace(/^g.*/, 'g');
    },
    dimensions_unit: (text, row) => {
      if (text === 'null' && row.dimensions_unit_backup?.[0]?.text !== undefined) {
        return row.dimensions_unit_backup?.[0]?.text;
      }
      return text;
    },
  };

  const fallbackMapping = {
    length: (text, row) => {
      const fromUnlabeled = resolveUnlabeledDimensions(text, row, 0);
      if (fromUnlabeled) { return fromUnlabeled; }
      if (row.length_fallback?.[0]?.text) {
        const number = Number(row.length_fallback?.[0]?.text);
        if (number) { return String(number); }
      }
      return text;
    },
    width: (text, row) => resolveUnlabeledDimensions(text, row, 1),
    height: (text, row) => {
      const fromUnlabeled = resolveUnlabeledDimensions(text, row, 2);
      if (fromUnlabeled) { return fromUnlabeled; }
      if (row.height_fallback?.[0]?.text) {
        const number = Number(row.height_fallback?.[0]?.text);
        if (number) { return String(number); }
      }
      return text;
    },
  };

  const dimensionHeaders = ['height', 'length', 'width', 'depth', 'diameter'];
  const mappingFct = (header, arr, row) => [...arr.map(({ text, ...other }) => ({ text: mapping[header](text, row), ...other }))];
  const fallbackMappingFct = (header, arr, row) => [...arr.map(({ text, ...other }) => ({ text: fallbackMapping[header](text, row), ...other }))];
  let dimensionsFound = false;
  data.forEach(obj => obj.group.forEach(row => Object.keys(row).forEach((header) => {
    if (mapping[header]) {
      // eslint-disable-next-line no-param-reassign
      row[header] = mappingFct(header, row[header], row);
      // this will make dimensionsFound into true if at least one dimension is not null
      if (dimensionHeaders.includes(header)) {
        dimensionsFound = dimensionsFound || (row[header]?.[0]?.text !== null);
      }
    }
  })));
  // if no dimensions were found we use the fallback values which
  if (!dimensionsFound) {
    data.forEach(obj => obj.group.forEach(row => Object.keys(row).forEach((header) => {
      if (fallbackMapping[header]) {
        // eslint-disable-next-line no-param-reassign
        row[header] = fallbackMappingFct(header, row[header], row);
      }
    })));
  }
  return data;
};

module.exports = { cleanUp };
