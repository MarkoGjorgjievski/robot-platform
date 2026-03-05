const { cleanUp } = require('./transform');

module.exports = {
  implements: 'robots/san-antonio/extract',
  parameterValues: {
    country: 'UK',
    store: null,
    transform: cleanUp,
    domain: 'wayfair',
    schemaYAML: 'singlePage',
  },
};
