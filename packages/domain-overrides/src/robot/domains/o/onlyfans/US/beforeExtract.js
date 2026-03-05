module.exports = {
  implements: 'robots/san-antonio/beforeExtract',
  parameterValues: {
    country: 'US',
    domain: 'onlyfans',
    schemaYAML: 'singlePage',
  },
  dependencies: { helperModule: 'module:helpers/helpers', goto2: 'action:navigation/goto2' },
  path: './domains/${domain[0:1]}/${domain}/${country}/beforeExtract',
  implementation: async (inputs, parameters, context, dependencies) => {
    const { helperModule: { Helpers }, goto2 } = dependencies;
    const helper = new Helpers(context);

    await helper.optionalWait('[class*="main-container"]');
    await goto2(inputs);
    await helper.optionalWait('[class*="main-container"]');
  },
};
