/* eslint-disable no-param-reassign
*/
/**
 *
 * @param {ImportIO.Group[]} data
 * @returns {ImportIO.Group[]}
 */

const cleanUp = (data) => {
  function extractColor(input) {
    const regex = /顏色\s*：\s*(\w+)/i; // Match "顏色：" followed by any word characters
    const match = input.match(regex);
    if (match) {
      return match[1].toUpperCase(); // Return the matched color in uppercase
    }
    return null; // Return null if no color information found
  }
  function extractDimensions(input) {
    // Adjusted regex to make the third dimension optional
    const regex = /(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)(?:\s*x\s*(\d+(?:\.\d+)?))?/i;
    const match = input.match(regex);
    if (match) {
      const dimensions = match
        .slice(1)
        .map(str => (str ? parseFloat(str) : null)); // Parse floats, handle missing dimensions as null

      // Adjust return object to use length, width, and height
      return {
        length: dimensions[0],
        width: dimensions[1],
        height: dimensions[2] !== undefined ? dimensions[2] : null, // Ensure height is null if not provided
      };
    }
    return null;
  }
  function extractFirstNumber(str) {
    // This regex matches the first occurrence of a number which can be a whole number or decimal
    const regex = /\d+([.,]\d+)?/;
    const match = str?.match(regex);
    return match ? parseFloat(match[0]) : null; // Convert the match to a float if found, else return null
  }
  function extractWeightFromText(text) {
    const arr = text.split('重 量');
    return extractFirstNumber(arr[1]);
  }
  const mapping = {
    stock_availability: text => (text === 'no' ? 'no' : 'yes'),
    width: text => extractDimensions(text)?.width?.toString() || null,
    height: text => extractDimensions(text)?.height?.toString() || null,
    length: text => extractDimensions(text)?.length?.toString() || null,
    weight_raw: text => extractWeightFromText(text)?.toString() || null,
    // eslint-disable-next-line consistent-return
    color2: text => extractColor(text),
    colorMod: (text, row) => {
      if (!row.colour?.[0].text) {
        row.colour = row.color2;
      }
    },
  };

  const mappingFct = (header, arr, row) => arr.map(({
    text,
    ...other
  }) => ({ text: mapping[header](text, row), ...other }));

  data.forEach(obj => obj.group.forEach(row => Object.keys(row)
    .forEach((header) => {
      // eslint-disable-next-line no-param-reassign
      if (mapping[header]) row[header] = mappingFct(header, row[header], row);
    })));

  return data;
};

module.exports = { cleanUp };
