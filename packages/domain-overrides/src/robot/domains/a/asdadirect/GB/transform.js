/* eslint-disable no-param-reassign
*/
/**
 *
 * @param {ImportIO.Group[]} data
 * @returns {ImportIO.Group[]}
 */

const cleanUp = (data) => {
  // regex pattern from Ikea Schema, with 'cms' added
  const unitRegex = /(?<unit>(mm|cm|cms|m|in|ft|ft'in))$/;
  const weightUnitRegex = /(?<unit>(kg|g|lbs|oz|m[lL]|L|c[lL]))$/;
  const lastNumberRegex = /(?<lastNumber>\d+(?:[.,]\d+)?)(?!.*\d+(?:[.,]\d+)?)/;
  const firstNumberRegex = /(?<firstNumber>\d+(?:[.,]\d+)?).*/;

  const getDimensionsUnit = (text) => {
    text = text?.match(unitRegex)?.groups.dimensions_unit ?? 'cm';
    return text.replace('cms', 'cm');
  };
  const setMissingField = (value, field, row) => {
    console.log('-----setMissingField------');
    console.log(value);
    console.log(field);
    if (value && !row[field]) {
      row[field] = [{ text: value }];
    }
  };

  const dimension3D = (text, row) => {
    // Dimensions (WxDxH in cm) = 19 x 21 x 62cm
    const dimArray = text.split('x').map(str => str.match(lastNumberRegex)?.groups.lastNumber);

    ['width', 'depth', 'height'].map((field, i) => setMissingField(dimArray[i], field, row));
    setMissingField(getDimensionsUnit(text), 'dimensions_unit', row);

    return text;
  };

  const dimensionSize = (text, row) => {
    // Size = W 228cm (90 Inch) x D 228cm (90 Inch)
    const dimArray = text.split('x').reduce(
      (acc, str) => ({
        ...acc,
        [['W', 'D', 'H'].reduce((accInner, letter) => (str?.includes(letter) ? letter : accInner), '')]: str?.match(firstNumberRegex)?.groups.firstNumber,
      }),
      {},
    );

    ['width', 'depth', 'height'].map(field => setMissingField(dimArray[field.toUpperCase()[0]], field, row));

    // check typical paterns as well
    dimension3D(text, row);

    // set default unit if none detected
    setMissingField('cm', 'dimensions_unit', row);

    return text;
  };

  const lastNumber = text => text
    ?.match(lastNumberRegex)
    ?.groups.lastNumber;

  const mapping = {
    // no ratings are indicated by negative value...
    average_rating: text => (text < 0 ? 0 : text),

    stock_availability: text => JSON.parse(text).some(x => x),

    currency: text => JSON.parse(text)[0],
    original_price: text => `${JSON.parse(text)[0]}`,
    offer_price: text => `${JSON.parse(text)[0]}`,

    weight: text => text
      ?.match(firstNumberRegex)
      ?.groups.weight,
    weight_unit: text => text
      ?.match(weightUnitRegex)
      ?.groups.unit
      ?.toLowerCase()
          ?? 'kg',

    // extract metric data from fields formatted like: 66" (168cm)
    length: lastNumber,
    width: lastNumber,
    depth: lastNumber,
    height: lastNumber,

    dimension3D,
    dimensionFolded: dimension3D,
    dimensionSize,
    dimensionSizeVariantInStock: dimensionSize,
    dimensionSizeVariantAny: dimensionSize,

    // fallback field for textile if Materials is missing
    fabricComposition: (text, row) => {
      setMissingField(text, 'materials', row);
    },

    // remove line breaks
    description: (text) => {
      console.log('Removing html tags and escape characters from description.');
      console.log(`Transforming from: ${text}`);
      const replaced = text
        .replace(/<br\s?\/>/g, '')
        .replace(/\\n/g, '\n');
      console.log(`Transformed to: ${replaced}`);
      return replaced;
    },
  };

  const mappingFct = (header, arr, row) => arr.map(({ text, ...other }) => ({ text: mapping[header](text, row), ...other }));

  data.forEach(obj => obj.group.forEach((row) => {
    Object.keys(row).forEach((header) => {
      // eslint-disable-next-line no-param-reassign
      if (mapping[header]) row[header] = mappingFct(header, row[header], row);
    });
  }));

  return data;
};

module.exports = { cleanUp };
