const { cleanUp } = require('./transform');

module.exports = {
  implements: 'robots/san-antonio/extract',
  parameterValues: {
    country: 'İT',
    store: null,
    transform: cleanUp,
    domain: 'zarahome',
    schemaYAML: 'singlePage',
  },
};
