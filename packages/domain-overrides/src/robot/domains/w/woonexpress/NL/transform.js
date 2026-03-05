/**
 *
 * @param {ImportIO.Group[]} data
 * @returns {ImportIO.Group[]}
 */
//
const cleanUp = (data) => {
  const dimensionRegex = /\d+[,.]?\d+/g;
  const mapping = {
    dimensions_unit: (textValue, row) => row.dimensions_unit[row.dimensions_unit.length - 1].text,
    weight_raw: (textValue) => {
      if (!textValue) {
        return null;
      }
      let copyOfTextValue = textValue.toString().trim();
      while ((copyOfTextValue.match(/,/g) || []).length > 1) {
        copyOfTextValue = copyOfTextValue.slice(0, copyOfTextValue.indexOf(','))
        + copyOfTextValue.slice(copyOfTextValue.indexOf(',') + 1, copyOfTextValue.length);
      }
      while ((copyOfTextValue.match(/\./g) || []).length > 1) {
        copyOfTextValue = copyOfTextValue.slice(0, copyOfTextValue.indexOf('.'))
      + copyOfTextValue.slice(copyOfTextValue.indexOf('.') + 1, copyOfTextValue.length);
      }
      return copyOfTextValue;
    },
    dimension_string: (text, row) => {
      if (dimensionRegex.exec(text) === null || text === null) {
        return null;
      }
      const dimArrayForEachPack = text.split(' / ');
      dimArrayForEachPack.forEach((dim) => {
        const dimensionArray = dim
          .split('x')
          .map(str => str?.match(dimensionRegex)?.[0]);
        const cloneDiameter = dimensionArray.indexOf(row.diameter?.[0]?.text);
        if (cloneDiameter >= 0) {
          dimensionArray.splice(cloneDiameter, 1);
        }
        ['height', 'width', 'length'].forEach((dimensionName, index) => {
          if (
            dimensionArray[index]
            && (parseInt(row[dimensionName]?.[0]?.text, 10)
              < parseInt(dimensionArray[index], 10)
              || !row[dimensionName]?.[0]?.text)
          ) {
            // eslint-disable-next-line no-param-reassign
            row[dimensionName] = [{ text: dimensionArray[index] }];
          }
        });
      });
      return text;
    },
    original_price: (text, row) => (text === '-1' && row.offer_price[0].text ? row.offer_price[0].text : text),
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
