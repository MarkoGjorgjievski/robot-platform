const { cleanUp } = require('./transform');

module.exports = {
  implements: 'robots/san-antonio/extract',
  parameterValues: {
    country: 'GB',
    store: null,
    transform: cleanUp,
    domain: 'asdadirect',
    schemaYAML: 'multiPages',
  },
};
