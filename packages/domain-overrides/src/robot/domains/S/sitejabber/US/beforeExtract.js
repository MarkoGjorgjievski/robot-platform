module.exports = {
  implements: 'robots/san-antonio/beforeExtract',
  parameterValues: {
    country: 'US',
    domain: 'sitejabber',
    schemaYAML: 'multiPages',
  },
  implementation: async (inputs, parameters, context) => {
    await context.evaluate(() => {
      const div = document.createElement('div');
      div.id = 'pageURL';
      div.innerText = window.location.href;
      document.body.appendChild(div);
    });
  },
};
