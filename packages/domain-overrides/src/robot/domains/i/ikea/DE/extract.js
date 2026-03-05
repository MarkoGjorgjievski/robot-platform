const { cleanUp } = require('./transform.js');

module.exports = {
  implements: 'robots/san-antonio/extract',
  parameterValues: {
    country: 'DE',
    store: null,
    transform: cleanUp,
    domain: 'ikea',
    schemaYAML: 'multiPages',
  },
};
