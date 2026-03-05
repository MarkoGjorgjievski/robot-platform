/**
 *
 * @param {ImportIO.Group[]} data
 * @returns {ImportIO.Group[]}
 */
const cleanUp = (data) => {
  function parseDimensions(inputStr) {
    // Remove the " cm" part and split by ": " to separate labels from values
    // eslint-disable-next-line no-unsafe-optional-chaining
    const [labelsPart, valuesPart] = inputStr.replace(' cm', '')
      ?.split(': ');

    // Split the values by "/" to get individual dimension values
    const values = valuesPart?.split('/')
      .map(value => parseFloat(value.replace(',', '.')));

    // Initialize the dimensions object
    const dimensions = {
      length: null,
      width: null,
      height: null,
      depth: null,
    };

    // Determine and assign values based on the labels present
    const labels = labelsPart?.split('/');
    labels.forEach((label, index) => {
      switch (label) {
        case 'szélesség':
          dimensions.width = values[index];
          break;
        case 'magasság':
          dimensions.height = values[index];
          break;
        case 'mélység':
          dimensions.depth = values[index];
          break;
        case 'hosszúság':
          dimensions.length = values[index];
          break;
          // eslint-disable-next-line no-unused-expressions
        default: null;
      }
    });

    return dimensions;
  }
  function extractPackSize(inputString) {
    // Regular expression to match patterns like "10 pcs/pack" or variations thereof
    const packSizeRegex = /(\d+)\s*(pcs\/pack|parts)/i;

    // Attempt to match the regular expression to the input string
    const match = inputString.match(packSizeRegex);

    // If a match is found, return the first captured group (the numeric value)
    if (match) {
      return parseInt(match[1], 10);
    }
    // If no match is found, return a default value of 1
    return 1;
  }

  const mapping = {
    stock_availability: text => (text === 'yes' ? 'yes' : 'no'),
    materials: text => text.replace(/anyag:/i, ''),
    colour: text => text.replace(/szín:/i, ''),
    product_variations: text => `https://www.moebelix.hu${text.trim()}`.replace(' ', ''),
    height: text => (text ? parseDimensions(text)?.height?.toString() : null),
    width: text => (text ? parseDimensions(text)?.width?.toString() : null),
    depth: text => (text ? parseDimensions(text)?.depth?.toString() : null),
    length: text => (text ? parseDimensions(text)?.length?.toString() : null),
    pack_size: text => (text ? extractPackSize(text) : 1),
  };
  const mappingFct = (header, arr, row) => [...arr.map(({
    text,
    ...other
  }) => ({ text: mapping[header](text, row), ...other }))];
  data.forEach(obj => obj.group.forEach(row => Object.keys(row)
    .forEach((header) => {
      // eslint-disable-next-line no-param-reassign
      if (mapping[header]) row[header] = mappingFct(header, row[header], row);
    })));
  return data;
};

module.exports = { cleanUp };
