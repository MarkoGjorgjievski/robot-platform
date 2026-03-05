module.exports = {
  implements: 'robots/san-antonio/beforeExtract',
  parameterValues: {
    country: 'CN',
    domain: 'nitori',
    schemaYAML: 'multiPages',
  },
  dependencies: { helpers: 'module:helpers/helpers' },
  implementation: async (inputs, parameters, context, dependencies) => {
    const { helpers: { Helpers } } = dependencies;
    const helpers = new Helpers(context);
    const hasPrice = await helpers.checkSelector('div.goods-price');
    if (!hasPrice && inputs.schemaYAML === 'singlePage') await context.reload();
  },
};
