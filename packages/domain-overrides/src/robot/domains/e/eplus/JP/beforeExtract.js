module.exports = {
  implements: 'robots/san-antonio/beforeExtract',
  parameterValues: {
    country: 'JP',
    domain: 'eplus',
    schemaYAML: 'multiPages',
  },
  dependencies: { helpers: 'module:helpers/helpers' },
  // implementation: async (inputs, parameters, context, dependencies) => {
  //   if (inputs.schemaYAML === 'multiPages') {
  //     const { helpers: { Helpers } } = dependencies;
  //     const helpers = new Helpers(context);
  //     await helpers.ifThereClickOnIt('button.block-more-next__trigger');
  //     await helpers.optionalWait('//button[contains(@class,"block-more-next__trigger") and not(contains(@class,"loading"))]', 6000, 'XPATH');
  //     const res = await context.searchForRequest('koenbi', 'GET', 0, 6000);
  //     const decodedData = Buffer.from(res.responseBody.body, 'base64').toString('utf-8');
  //     const decodedDataJSON = JSON.parse(decodedData);
  //     await Promise.all(decodedDataJSON.data.record_list.map(async (el, index) => {
  //       await context.saveJson(`eventURLDATA_${index}_${inputs.page}`, el);
  //     }));
  //   }
  // },
};
