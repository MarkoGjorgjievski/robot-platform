const { cleanUp } = require('./transform');

module.exports = {
  implements: 'robots/san-antonio/extract',
  parameterValues: {
    country: 'SE',
    store: null,
    transform: cleanUp,
    domain: 'mio',
    schemaYAML: 'singlePage',
  },
};
