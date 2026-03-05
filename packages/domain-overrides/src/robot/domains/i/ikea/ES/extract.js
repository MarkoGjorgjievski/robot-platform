const { cleanUp } = require('./transform.js');

module.exports = {
  implements: 'robots/san-antonio/extract',
  parameterValues: {
    country: 'ES',
    store: null,
    transform: cleanUp,
    domain: 'ikea',
    schemaYAML: 'multiPages',
  },
};
