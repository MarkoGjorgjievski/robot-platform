/**
 *
 * @param {ImportIO.Group[]} data
 * @returns {ImportIO.Group[]}
 */
const cleanUp = (data) => {
  function extractColorsFromString(inputString) {
    // List of 40 most common color names
    const commonColors = [
      'red', 'blue', 'green', 'yellow', 'orange', 'purple', 'pink', 'brown', 'black', 'white',
      'cyan', 'magenta', 'lime', 'indigo', 'violet', 'maroon', 'olive', 'teal', 'navy', 'gray',
      'silver', 'gold', 'beige', 'ivory', 'tan', 'khaki', 'coral', 'salmon', 'peach', 'lavender',
      'plum', 'orchid', 'chartreuse', 'aquamarine', 'turquoise', 'sienna', 'peru', 'chocolate', 'rosybrown', 'darkslategray',
    ];

    // Regular expression for hexadecimal color codes
    const hexColorRegex = /#([0-9a-fA-F]{3}){1,2}\b/g;

    // Combine the color names and hexadecimal color code patterns
    const combinedRegex = new RegExp(`${commonColors?.join('|')}|${hexColorRegex.source}`, 'gi');

    // Extract matches from the input string
    const matches = inputString?.match(combinedRegex);

    // Return the first unique color found
    return matches ? [...new Set(matches)][0] : null;
  }
  const mapping = {
    stock_availability: text => (text === 'no' ? 'no' : 'yes'),
    colour: text => extractColorsFromString(text),
    product_variations: text => (text ? `https://www.bonami.hu${text}` : null),
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
