const { cleanUp } = require('./transform.js');

module.exports = {
  implements: 'robots/san-antonio/extract',
  parameterValues: {
    country: 'TH',
    store: null,
    transform: cleanUp,
    domain: 'lazada',
    schemaYAML: 'singlePage',
  },
};
