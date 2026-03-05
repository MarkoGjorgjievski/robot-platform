const { cleanUp } = require('./transform.js');

module.exports = {
  implements: 'robots/san-antonio/extract',
  parameterValues: {
    country: 'SA',
    store: null,
    transform: cleanUp,
    domain: 'ikea',
    schemaYAML: 'singlePage',
  },
};
