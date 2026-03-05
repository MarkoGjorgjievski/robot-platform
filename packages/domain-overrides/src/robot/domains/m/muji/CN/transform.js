/* eslint-disable no-param-reassign */
/**
 *
 * @param {ImportIO.Group[]} data
 * @returns {ImportIO.Group[]}
 */
const cleanUp = (data) => {
  const mapping = {
    productURL: (text) => {
      const regex = /item\/(\d+)_/;
      const match = regex.exec(text);
      return match ? `https://www.muji.com.cn/cn/store/commodity/${match[1]}` : null;
    },
    dimensions_data: (text, row) => {
      const regex = /\d+(?:,\d+)?(?:\.\d+)?/g;
      const matches = text.match(regex);

      if (!matches) {
        row.length[0].text = null;
        row.width[0].text = null;
        row.height[0].text = null;
        return;
      }

      const lengthData = matches[0];
      const widthData = matches[1];
      const heightData = matches[2];

      row.length[0] = { text: lengthData };
      row.width[0] = { text: widthData };
      row.height[0] = { text: heightData };
    },
    length: text => (text === 'dummy' ? null : text),
    width: text => (text === 'dummy' ? null : text),
    height: text => (text === 'dummy' ? null : text),
    original_price: (text, row) => (text === 'dummy' ? row.offer_price?.[0]?.text : text),
    product_variations_data: (text, row) => {
      const decodedData = Buffer.from(text, 'base64').toString('utf-8');
      const jsonData = JSON.parse(decodedData);
      const skusArray = jsonData.data.skus;
      // return skusArray[0].skuCd;
      const skuNums = skusArray.map(item => item.skuCd);

      for (let i = 0; i < skuNums.length; i += 1) {
        row.product_variations[i] = { text: `https://www.muji.com.cn/cn/store/commodity/${skuNums[i]}` };
      }

      return null;
    // const decodedData =(atob(text.responseBody.body)).data.map(item => item.skuCd)
    // const skuCodes = await context.evaluate(val => atob(val), jsonResponse.responseBody.body);
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
