const { cleanUp } = require('./transform');

module.exports = {
  implements: 'robots/san-antonio/extract',
  parameterValues: {
    country: 'BR',
    store: null,
    transform: cleanUp,
    domain: 'ingresse',
    schemaYAML: 'singlePage',
  },
};
