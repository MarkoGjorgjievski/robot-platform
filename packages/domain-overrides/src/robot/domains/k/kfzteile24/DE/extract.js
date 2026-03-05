const { cleanUp } = require('./transform');

module.exports = {
  implements: 'robots/san-antonio/extract',
  parameterValues: {
    country: 'DE',
    store: null,
    transform: cleanUp,
    domain: 'kfzteile24',
    schemaYAML: 'multiPages',
  },
};
