const { cleanUp } = require('./transform');

module.exports = {
  implements: 'robots/san-antonio/extract',
  parameterValues: {
    country: 'US',
    store: null,
    transform: cleanUp,
    domain: 'tjx',
    schemaYAML: 'singlePage',
  },
};
