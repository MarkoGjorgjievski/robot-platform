/* eslint-disable no-restricted-syntax */
/**
 *
 * @param {ImportIO.Group[]} data
 * @returns {ImportIO.Group[]}
 */
const transform = (data) => {
  for (const { group } of data) {
    for (const row of group) {
      for (const key in row) {
        // Check if the current key's value is an array with exactly more than 1 object
        if (Array.isArray(row[key]) && row[key].length > 1) {
          // keep the las object in the array
          row[key] = [row[key].pop()];
        }
      }
    }
  }
  return data;
};
module.exports = { transform };
