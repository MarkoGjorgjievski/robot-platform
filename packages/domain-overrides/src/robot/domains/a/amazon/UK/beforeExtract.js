module.exports = {
  implements: 'robots/san-antonio/beforeExtract',
  parameterValues: {
    country: 'UK',
    domain: 'amazon',
    schemaYAML: 'multiPages',
  },
  implementation: async (inputs, parameters, context) => {
    // if (inputs.schemaYAML === 'multiPages') await context.reload();
    if (inputs.schemaYAML === 'firstDepth') await context.reload();
    // if (inputs.schemaYAML === 'bpSinglePage') await context.reload();
  },
};
