const { cleanUp } = require('./transform');

module.exports = {
  implements: 'robots/san-antonio/extract',
  parameterValues: {
    country: 'FR',
    store: null,
    transform: cleanUp,
    domain: 'cdiscount',
    schemaYAML: 'multiPages',
  },
};
