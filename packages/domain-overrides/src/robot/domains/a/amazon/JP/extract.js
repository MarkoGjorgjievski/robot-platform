const { cleanUp } = require('./transform');

module.exports = {
  implements: 'robots/san-antonio/extract',
  parameterValues: {
    country: 'JP',
    store: null,
    transform: cleanUp,
    domain: 'amazon',
    schemaYAML: 'multiPages',
  },
};
