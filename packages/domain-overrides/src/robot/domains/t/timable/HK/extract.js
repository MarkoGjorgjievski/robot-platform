const { cleanUp } = require('./transform');

module.exports = {
  implements: 'robots/san-antonio/extract',
  parameterValues: {
    country: 'HK',
    store: null,
    domain: 'timable',
    transform: cleanUp,
    schemaYAML: 'singlePage',
  },
};
