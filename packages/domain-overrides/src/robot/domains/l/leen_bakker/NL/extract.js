const { cleanUp } = require('./transform');

module.exports = {
  implements: 'robots/san-antonio/extract',
  parameterValues: {
    country: 'NL',
    store: null,
    transform: cleanUp,
    domain: 'leen_bakker',
    schemaYAML: 'multiPages',
  },
};
