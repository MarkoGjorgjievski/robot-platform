const { cleanUp } = require('./transform');

module.exports = {
  implements: 'robots/san-antonio/extract',
  parameterValues: {
    country: 'nl',
    store: null,
    transform: cleanUp,
    domain: 'action',
    schemaYAML: 'singlePage',
  },
};
