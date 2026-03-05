const { cleanUp } = require('./transform');

module.exports = {
  implements: 'robots/san-antonio/extract',
  parameterValues: {
    country: 'CN',
    store: null,
    transform: cleanUp,
    domain: 'walmart',
    schemaYAML: 'multiPages',
  },
};
