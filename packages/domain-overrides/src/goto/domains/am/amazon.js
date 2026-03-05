module.exports = {
  dependencies: { customGoto: 'action:navigation/goto/domains/am/amazonCustomGoto' },
  implementation: async (inputs, parameters, context, { customGoto }) => customGoto(inputs, parameters),
};
