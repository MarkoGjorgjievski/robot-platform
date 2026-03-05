const { cleanUp } = require('./transform');

module.exports = {
  implements: 'robots/san-antonio/extract',
  parameterValues: {
    country: 'FI',
    store: null,
    transform: cleanUp,
    domain: 'lippu',
    schemaYAML: 'multiPages',
  },
};
