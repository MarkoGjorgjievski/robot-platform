const { cleanUp } = require('./transform');

module.exports = {
  implements: 'robots/san-antonio/extract',
  parameterValues: {
    country: 'SG',
    store: null,
    transform: cleanUp,
    domain: 'lazada',
    schemaYAML: 'singlePage',
  },
};
