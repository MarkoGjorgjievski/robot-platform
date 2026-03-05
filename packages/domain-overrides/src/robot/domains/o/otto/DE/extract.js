const { cleanUp } = require('./transform');

module.exports = {
  implements: 'robots/san-antonio/extract',
  parameterValues: {
    country: 'DE',
    store: null,
    transform: cleanUp,
    domain: 'otto',
    schemaYAML: 'multiPage',
  },
};
