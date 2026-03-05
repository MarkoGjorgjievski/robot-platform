module.exports = {
  implements: 'robots/san-antonio/beforeExtract',
  parameterValues: {
    country: 'IT',
    domain: 'vivaticket',
    schemaYAML: 'singlePage',
  },
  implementation: async (inputs, parameters, context, dependencies) => {
    const { helperModule: { Helpers } } = dependencies;
    const helper = new Helpers(context);
    await helper.ifThereClickOnIt('div.event-header__notice a');
  },
};
