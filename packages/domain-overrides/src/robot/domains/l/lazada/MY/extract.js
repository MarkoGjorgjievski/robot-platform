const { cleanUp } = require('./transform.js');

module.exports = {
  implements: 'robots/san-antonio/extract',
  parameterValues: {
    country: 'MY',
    store: null,
    transform: cleanUp,
    domain: 'lazada',
    schemaYAML: 'singlePage',
  },
};
