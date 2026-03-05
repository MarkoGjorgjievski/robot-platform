/* eslint-disable no-param-reassign */
/**
 *
 * @param {ImportIO.Group[]} data
 * @returns {ImportIO.Group[]}
 */
const cleanUp = (data) => {
  const mapping = {
    original_price: (text, row) => {
      const nextData = JSON.parse(text);
      const priceDetails = nextData.props.initialProps.dehydratedState.queries.find(query => query.state.data.priceDetails);
      const { highestPrice, lowestPrice } = priceDetails?.state.data.priceDetails || {};

      if (highestPrice) {
        row.offer_price = [{ text: lowestPrice }];

        return highestPrice;
      }

      return lowestPrice;
    },
    main_image: text => `${text}.jpg`,
    alternative_images: text => text.replace('pdp-th', 'pdp_d'),
    listing_id: text => text.split('.uk/')[1],
    product_vars: (text, row) => {
      row.product_variations = JSON.parse(text).props.initialProps.dehydratedState.queries.find(query => query.state.data.colourSelector)?.state.data.colourSelector.covers.map(cover => !cover.selected && ({ text: `https://www.dfs.co.uk/${cover.coverUrl}` })).filter(Boolean);

      return null;
    },
  };

  const mappingFct = (header, arr, row) => [...arr.map(({ text, ...other }) => ({ text: mapping[header](text, row), ...other }))];

  data.forEach(obj => obj.group.forEach(row => Object.keys(row).forEach((header) => {
    // eslint-disable-next-line no-param-reassign
    if (mapping[header]) row[header] = mappingFct(header, row[header], row);
  })));
  return data;
};

module.exports = { cleanUp };
