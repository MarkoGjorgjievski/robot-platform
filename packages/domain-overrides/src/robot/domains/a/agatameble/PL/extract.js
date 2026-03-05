const { cleanUp } = require('./transform.js');

module.exports = {
  implements: 'robots/san-antonio/extract',
  parameterValues: {
    country: 'PL',
    store: null,
    transform: cleanUp,
    domain: 'agatameble',
    schemaYAML: 'multiPages',
  },
};
