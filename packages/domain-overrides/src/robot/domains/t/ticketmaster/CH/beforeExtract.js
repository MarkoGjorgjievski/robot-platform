module.exports = {
  implements: 'robots/san-antonio/beforeExtract',
  parameterValues: {
    country: 'CH',
    domain: 'ticketmaster',
    schemaYAML: 'singlePage',
  },
  implementation: async (inputs, parameters, context, dependencies) => {
    const { helperModule: { Helpers } } = dependencies;
    const helper = new Helpers(context);
    await helper.ifThereClickOnIt('[data-testid="eventInfoBtn"]');
  },
};
