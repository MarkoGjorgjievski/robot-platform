module.exports = {
  implements: 'robots/san-antonio/beforeExtract',
  parameterValues: {
    country: 'KR',
    domain: 'interpark',
    schemaYAML: 'singlePage',
  },
  implementation: async (inputs, parameters, context) => {
    // const { helpers: { Helpers } } = dependencies;

    // const helpers = new Helpers(context);

    // await helpers.optionalWait("//div[contains(@class, 'quickMenuWrapper')]", 10000, 'XPATH');
    const res = await context.searchForRequest('playSeq');

    // const decodedData = Buffer.from(res.responseBody.body, 'base64').toString('utf-8');

    await context.saveJson('requestData', res);
  },
};
