module.exports = {
  implements: 'robots/san-antonio/beforeExtract',
  parameterValues: {
    country: 'JP',
    domain: 'johnnys',
    schemaYAML: 'multipages',
  },
  // implementation: async (inputs, parameters, context) => {
  //   if (inputs.schemaYAML === 'singlePage') {
  //     const body = await context.waitForSelector('body');
  //     console.log('------------------------------------', body);
  //     console.log('------------------------------------', body.innerHTML);
  //   }
  // },
  // implementation: async (inputs, parameters, context) => {
  //   if (inputs.schemaYAML === 'singlePage') {
  //     const res = await context.searchForRequest('youRequestWord', 'GET', 0, 6000);
  //     await context.saveJson(eventURLDATA, res.response.body);
  //   }
  // },
};
