/* eslint-disable no-param-reassign */
/**
 *
 * @param {ImportIO.Group[]} data
 * @returns {ImportIO.Group[]}
 */
const cleanUp = (data) => {
  const mapping = {
    dimensionsText: (text, row) => {
      const dimensionsDescription = row.dimensionsDescription?.[0]?.text?.toLowerCase();
      const dimensionsDescriptionSplitted = dimensionsDescription?.split('/');

      const dimensions = {
        breite: 'width',
        höhe: 'height',
        tiefe: 'depth',
        länge: 'length',
        durchmesser: 'diameter',
      };

      const finalDimensions = {};

      const dimensionsSplitted = text.split('/');
      console.log({ dimensionsSplitted });
      dimensionsDescriptionSplitted.forEach((dimension, index) => {
        finalDimensions[dimensions[dimension?.trim()]] = dimensionsSplitted[
          index
        ]
          ?.trim()
          .replace(',', '.');
      });

      if (finalDimensions.height) {
        row.height = [{ text: finalDimensions.height }];
      }

      if (finalDimensions.diameter) {
        row.diameter = [{ text: finalDimensions.diameter }];
      }

      if (finalDimensions.length) {
        row.length = [{ text: finalDimensions.length }];
      }

      if (finalDimensions.depth) {
        row.depth = [{ text: finalDimensions.depth }];
      }

      if (finalDimensions.width) {
        row.width = [{ text: finalDimensions.width }];
      }

      return text;
    },
    colour: (text) => {
      const rows = text.split('\n');
      const rowsWithColor = rows.filter(t => t?.toLowerCase().includes('farbe'));
      console.log({ rowsWithColor });
      const colorValues = rowsWithColor.map(t => t.split(':')[1]?.trim());
      return colorValues.join(', ');
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
