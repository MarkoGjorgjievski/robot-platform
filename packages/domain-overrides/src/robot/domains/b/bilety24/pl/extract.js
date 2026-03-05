const { cleanUp } = require('./transform');

module.exports = {
  implements: 'robots/san-antonio/extract',
  parameterValues: {
    country: 'pl',
    store: null,
    transform: cleanUp,
    domain: 'bilety24',
    schemaYAML: 'singlePage',
  },
};
