/* eslint-disable no-param-reassign */
/**
 *
 * @param {ImportIO.Group[]} data
 * @returns {ImportIO.Group[]}
 */
//
const cleanUp = (data) => {
  const mapping = {
    productId: (text, row) => {
      row.reviewsUrl = [{ text: `https://api.bazaarvoice.com/data/reviews.json?passkey=caTvb3cP3PN4BK8IbQMNfIyL673vNTIiD66ZQEK0MQA5M&locale=ja_JP&allowMissing=true&apiVersion=5.4&filter=productid:${text}&limit=50` }];
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
