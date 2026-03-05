const { cleanUp } = require('./transform');

module.exports = {
  implements: 'robots/san-antonio/extract',
  parameterValues: {
    country: 'RO',
    store: null,
    transform: cleanUp,
    domain: 'iabilet',
    schemaYAML: 'multiPages',
  },
};
