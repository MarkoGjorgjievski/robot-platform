/* eslint-disable no-param-reassign */
/**
 *
 * @param {ImportIO.Group[]} data
 * @returns {ImportIO.Group[]}
 */
const cleanUp = (data) => {
  data.forEach(obj => obj.group.forEach((row) => {
    if (row.original_price_extra && !row.original_price) {
      row.original_price = row.original_price_extra;
    }

    if (row.listing_id) {
      const list = row.listing_id[0].text.split('-');
      row.listing_id = [
        {
          ...row.listing_id[0],
          text: list[list.length - 1],
        },
      ];
    }

    if (row.original_price) {
      row.original_price = [
        {
          ...row.original_price[0],
          text:
              row.original_price[0].text?.toString()
                ?.replace(',', '.'),
        },
      ];
    }
    if (row.offer_price) {
      row.offer_price[0] = [
        {
          ...row.offer_price[0],
          text:
              row.offer_price[0].text?.toString()
                ?.replace(',', '.'),

        },
      ];
    }
  }));
  return data;
};

module.exports = { cleanUp };
