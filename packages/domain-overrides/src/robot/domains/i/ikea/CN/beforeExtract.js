module.exports = {
  implements: 'robots/san-antonio/beforeExtract',
  parameterValues: {
    country: 'CN',
    domain: 'ikea',
    schemaYAML: 'multiPages',
  },
  dependencies: { helpers: 'module:helpers/helpers' },
  implementation: async (inputs, parameters, context, dependencies) => {
    const { helpers: { Helpers } } = dependencies;
    const helpers = new Helpers(context);
    const hasPrice = await helpers.checkSelector('.withprice-price');
    if (!hasPrice && inputs.schemaYAML === 'singlePage') await context.reload();
  },
};
