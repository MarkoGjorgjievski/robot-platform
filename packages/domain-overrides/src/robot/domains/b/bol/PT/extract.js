const { cleanUp } = require('./transform');

module.exports = {
  implements: 'robots/san-antonio/extract',
  parameterValues: {
    country: 'PT',
    store: null,
    transform: cleanUp,
    domain: 'bol',
    schemaYAML: 'singlePage',
  },
};
