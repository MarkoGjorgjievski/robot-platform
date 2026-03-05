const { cleanUp } = require('./transform');

module.exports = {
  implements: 'robots/san-antonio/extract',
  parameterValues: {
    country: 'IN',
    store: null,
    transform: cleanUp,
    domain: 'bookmyshow',
    schemaYAML: 'multiPages',
  },
};
