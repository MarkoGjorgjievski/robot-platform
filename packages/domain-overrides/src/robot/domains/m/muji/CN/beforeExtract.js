module.exports = {
  implements: 'robots/san-antonio/beforeExtract',
  parameterValues: {
    country: 'CN',
    domain: 'muji',
    schemaYAML: 'multiPages',
  },
  implementation: async (inputs, parameters, context) => {
    const res = await context.searchForRequest('skuCd');
    // try {
    // const skuCodes = await context.evaluate((val) => { return atob(val)}, res.responseBody.body);
    // const parsedData = JSON.parse(skuCodes);
    // const skuCdNumbers = parsedData.data.map(item => item.skuCd);
    await context.saveJson('requestData', res.responseBody.body);
    // } catch (error) {
    //   console.error('Error decoding:', error);
    // }
  },
};
