const { cleanUp } = require('./transform');

module.exports = {
  implements: 'robots/san-antonio/extract',
  parameterValues: {
    country: 'CA',
    store: null,
    transform: cleanUp,
    domain: 'thebrick',
    schemaYAML: 'multiPages',
  },
};
