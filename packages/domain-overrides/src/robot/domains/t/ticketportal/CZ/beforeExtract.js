module.exports = {
  implements: 'robots/san-antonio/beforeExtract',
  parameterValues: {
    country: 'CZ',
    domain: 'ticketportal',
    schemaYAML: 'multiPage',
  },
  implementation: async (inputs, parameters, context, dependencies) => {
    console.log('MYDEBUG', inputs);
    const { helperModule: { Helpers } } = dependencies;
    const helper = new Helpers(context);
    if (inputs.schemaYAML === 'multiPage') {
      // eslint-disable-next-line sonarjs/no-duplicate-string
      await helper.ifThereClickOnIt('button#btn-load');
      await helper.ifThereClickOnIt('button#btn-load');
      await helper.ifThereClickOnIt('button#btn-load');
    }
    if (inputs.schemaYAML === 'singlePage') {
      const { previousURL } = inputs;
      await context.saveJson('prevURL', { val: previousURL });
    }
  },
};
