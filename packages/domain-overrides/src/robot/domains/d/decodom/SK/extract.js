const { cleanUp } = require('./transform.js');

module.exports = {
  implements: 'robots/san-antonio/extract',
  parameterValues: {
    country: 'slovakia-SK',
    store: null,
    transform: cleanUp,
    domain: 'decodom',
    schemaYAML: 'singlePage',
  },
};
