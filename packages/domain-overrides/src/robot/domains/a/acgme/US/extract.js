const { transform } = require('./transform');

module.exports = {
  implements: 'robots/san-antonio/extract',
  parameterValues: {
    country: 'US',
    store: null,
    transform,
    domain: 'acgme',
    schemaYAML: 'multiPages',
  },
};
