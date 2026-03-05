const { cleanUp } = require('./transform');

module.exports = {
  implements: 'robots/san-antonio/extract',
  parameterValues: {
    country: 'br',
    store: null,
    transform: cleanUp,
    domain: 'uhuu',
    schemaYAML: 'singlePage',
  },
};
