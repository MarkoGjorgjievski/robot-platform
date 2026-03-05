const { cleanUp } = require('./transform.js');

module.exports = {
  implements: 'robots/san-antonio/extract',
  parameterValues: {
    country: 'GB',
    store: null,
    transform: cleanUp,
    domain: 'john-lewis',
    schemaYAML: 'multiPages',
  },
};
