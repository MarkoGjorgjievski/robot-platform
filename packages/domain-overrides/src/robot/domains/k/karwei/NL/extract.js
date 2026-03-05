const { cleanUp } = require('./transform.js');

module.exports = {
  implements: 'robots/san-antonio/extract',
  parameterValues: {
    country: 'NL',
    store: null,
    transform: cleanUp,
    domain: 'karwei',
    schemaYAML: 'multiPages',
  },
};
