const { cleanUp } = require('./transform');

module.exports = {
  implements: 'robots/san-antonio/extract',
  parameterValues: {
    country: 'HU',
    store: null,
    domain: 'xxxl',
    transform: cleanUp,
    schemaYAML: 'multiPages',
  },
};
