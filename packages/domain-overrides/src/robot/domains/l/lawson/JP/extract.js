const { cleanUp } = require('./transform.js');

module.exports = {
  implements: 'robots/san-antonio/extract',
  parameterValues: {
    country: 'JP',
    store: null,
    transform: cleanUp,
    domain: 'lawson',
    schemaYAML: 'singlePage',
  },
};
