const { cleanUp } = require('./transform.js');

module.exports = {
  implements: 'robots/san-antonio/extract',
  parameterValues: {
    country: 'PH',
    store: null,
    transform: cleanUp,
    domain: 'lazada',
    schemaYAML: 'singlePage',
  },
};
