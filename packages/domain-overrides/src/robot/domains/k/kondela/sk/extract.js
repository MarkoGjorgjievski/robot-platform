const { cleanUp } = require('./transform');

module.exports = {
  implements: 'robots/san-antonio/extract',
  parameterValues: {
    country: 'sk',
    store: null,
    transform: cleanUp,
    domain: 'kondela',
    schemaYAML: 'singlePage',
  },
};
