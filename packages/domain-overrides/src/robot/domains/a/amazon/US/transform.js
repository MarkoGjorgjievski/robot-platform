/* eslint-disable no-param-reassign
*/
/**
 *
 * @param {ImportIO.Group[]} data
 * @returns {ImportIO.Group[]}
 */

const cleanUp = (data) => {
  function getMeasurementDetails(inputString) {
    const regex = /(\d+(\.\d+)?)\s*(oz|ounce|fl.*oz|millilitres|kilograms|kg|g|liters|L|ml)\b/i;
    const match = inputString?.match(regex);

    if (match) {
      const value = parseFloat(match?.[1]).toString(); // Extract the numerical value and convert it to a float
      const unit = match?.[3]?.toLowerCase(); // Extract the unit of measurement and convert it to lowercase
      return { value, unit }; // Return an object containing the value and unit
    }
    return null; // Return null if no match is found
  }

  function checkString(input) {
    const regex = /Visit the (.+?) Store/;
    const match = input.match(regex);
    return match ? match?.[1] : input;
  }
  const correctRank = (str) => {
    const arr = str.split(' ');
    return arr?.[0];
  };
  function extractISODate(inputString) {
    // Use a regular expression to extract the date portion from the string
    const datePattern = /on (\w+ \d+, \d{4})/;
    const match = inputString.match(datePattern);

    if (match && match[1]) {
      // Convert the extracted date to a Date object
      const date = new Date(match[1]);
      // Return the date in ISO format
      return date.toISOString();
    }
    // Return a message if the date is not found or invalid
    return 'Invalid date format.';
  }

  const mapping = {
    resellerName: (text, row) => {
      if (text === 'Amazon') { row.resellerId = [{ text: 'N/A' }]; }
      return text;
    },
    reviewScore: text => (text ? text.split(' ')[0] : null),
    price: text => (text ? text?.replace('$', ' ') : null),
    titleCurated: text => (text.includes(',') ? text.split(',')?.[0] : text),
    size: text => (text ? getMeasurementDetails(text)?.value.toString() : null),
    brandRaw: text => (text ? checkString(text)?.replace('Brand:', '') : null),
    brandCurated: text => text?.replace('Brand:', ''),
    productReviewURL: text => (text ? `https://www.amazon.com${text}` : null),
    uom: text => (text ? getMeasurementDetails(text)?.unit.toString() : null),
    modifier: (text, row) => {
      row.brandRaw = [row?.brandRaw?.[0]];
    },
    modifier_2: (text, row) => {
      row.titleRaw = [row?.titleRaw?.[0]];
    },
    sizeModifier: (text, row) => {
      row.size = [row?.size?.[0]];
      row.uom = [row?.uom?.[0]];
    },
    reviewRating: text => (text ? correctRank(text) : null),
    reviewDate: text => (text ? extractISODate(text) : null),
  };

  const mappingFct = (header, arr, row) => arr.map(({ text, ...other }) => ({ text: mapping[header](text, row), ...other }));

  data.forEach(obj => obj.group.forEach(row => Object.keys(row).forEach((header) => {
    // eslint-disable-next-line no-param-reassign
    if (mapping[header]) row[header] = mappingFct(header, row[header], row);
  })));
  return data;
};

module.exports = { cleanUp };
