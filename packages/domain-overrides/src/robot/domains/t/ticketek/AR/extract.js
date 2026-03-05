const { cleanUp } = require('./transform');

module.exports = {
  implements: 'robots/san-antonio/extract',
  parameterValues: {
    country: 'AR',
    store: null,
    transform: cleanUp,
    domain: 'ticketek',
    schemaYAML: 'multiPages',
  },
};
