const { cleanUp } = require('./transform');

module.exports = {
  implements: 'robots/san-antonio/extract',
  parameterValues: {
    country: 'HU',
    store: null,
    transform: cleanUp,
    domain: 'ikea',
    schemaYAML: 'multiPages',
  },
};
