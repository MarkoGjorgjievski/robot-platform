module.exports = {
  implements: 'robots/san-antonio/beforeExtract',
  parameterValues: {
    country: 'US',
    domain: 'jcp1seg',
    schemaYAML: 'singlePage',
  },
  implementation: async (inputs, parameters, context, dependencies) => {
    const { helperModule: { Helpers } } = dependencies;
    const helper = new Helpers(context);
    await new Promise(resolve => setTimeout(resolve, 5000));
    if (await helper.checkXpathSelector('//*[contains(text(),"Supplier Name")]')) {
      console.log('>>>>>>>>>>>>>>>>Page is fine<<<<<<<<<<<<<<<<');
    } else {
      console.log('>>>>>>>>>>>>>>>>Page is blocked<<<<<<<<<<<<<<<<');
      await context.reportBlocked(702, 'Soft blocked. Did not load');
    }
  },
};
