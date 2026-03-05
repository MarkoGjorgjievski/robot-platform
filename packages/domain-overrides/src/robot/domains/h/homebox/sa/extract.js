const { cleanUp } = require('./transform');

module.exports = {
  implements: 'robots/san-antonio/extract',
  parameterValues: {
    country: 'sa',
    store: null,
    transform: cleanUp,
    domain: 'homebox',
    schemaYAML: 'singlePage',
  },
};
