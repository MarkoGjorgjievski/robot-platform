const { cleanUp } = require('./transform');

module.exports = {
  implements: 'robots/san-antonio/extract',
  parameterValues: {
    country: 'DE',
    store: false,
    transform: cleanUp,
    domain: 'porta',
    schemaYAML: 'multiPages',
  },
};
