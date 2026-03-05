/**
 *
 * @param {ImportIO.Group[]} data
 * @returns {ImportIO.Group[]}
 */
const cleanUp = (data) => {
  data.forEach(obj => obj.group.forEach((row) => {
    if (row.width) {
      const currentItem = row?.width[0];
      currentItem.text = currentItem.text.replace(',', '.');
      // eslint-disable-next-line no-param-reassign
      row.width = [currentItem];
    }
    // eslint-disable-next-line no-param-reassign
    row.product_variations = [
      ...(row?.product_variations_1 || []),
      ...(row?.product_variations_2 || []),
    ];
  }));

  return data;
};

module.exports = { cleanUp };
