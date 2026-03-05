module.exports = {
  implements: 'robots/san-antonio/beforeExtract',
  parameterValues: {
    domain: 'abyat',
    country: 'sa',
    schemaYAML: 'multiPages',
  },
  dependencies: { helpers: 'module:helpers/helpers' },
  implementation: async (inputs, parameters, context, dependencies) => {
    const { helpers: { Helpers } } = dependencies;
    const helpers = new Helpers(context);
    if (inputs.schemaYAML === 'singlePage') {
      await helpers.optionalWait('//div[contains(@class,"product-details")]', '5000', 'XPATH');
      const res = await context?.searchForRequest('category')?.then(result => JSON?.parse(result.responseBody.body));
      if (res !== undefined) await context.saveJson('requestData', res);
    }
  },
};
