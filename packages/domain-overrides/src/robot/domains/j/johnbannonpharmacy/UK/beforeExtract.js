module.exports = {
  implements: 'robots/san-antonio/beforeExtract',
  parameterValues: {
    country: 'UK',
    domain: 'johnbannonpharmacy',
    schemaYAML: 'multiPages',
  },
  implementation: async (inputs, parameters, context) => {
    await context.evaluate(async () => {
      const pageURL = window.location.href;
      const node = document.createElement('div');
      node.id = 'pageURLData';
      node.innerText = pageURL;
      document.body.appendChild(node);
    });
  },
};
