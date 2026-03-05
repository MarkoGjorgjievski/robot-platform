/**
 *
 * @param {ImportIO.Group[]} data
 * @returns {ImportIO.Group[]}
 */
const cleanUp = (data) => {
  const mapping = {
    skuReviews: (text, row) => {
      // eslint-disable-next-line no-param-reassign
      row.reviewsUrl = [{ text: `https://www.discoverglo.com/it/it/graphql?query={ products(filter: { sku: {eq: "${text}"} }) { items { name sku rating_summary review_count reviews(pageSize: 400) { total_count items { average_rating nickname summary text ratings_breakdown { name value } created_at } } } total_count page_info { page_size } } }` }];
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
