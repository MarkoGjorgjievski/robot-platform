module.exports = {
  implements: 'robots/san-antonio/beforeExtract',
  parameterValues: {
    country: 'SK',
    domain: 'sconto',
    schemaYAML: 'multiPages',
  },
  // implementation: async (inputs, parameters, context) => {
  //   console.log('searching for request!');
  //   // does NOT work for POST request!!!
  //   const res = await context.searchForRequest('widget.php');
  //
  //   console.log('-----------------------------------res?.responseBody?.body-----------------------------------');
  //   console.log(res?.responseBody?.body);
  //
  //   console.log('saving JSON:');
  //   await context.saveJson('requestData', res?.responseBody?.body);
  // },
};
