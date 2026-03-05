const { cleanUp } = require('./transform');

module.exports = {
  implements: 'robots/san-antonio/extract',
  parameterValues: {
    country: 'IT',
    store: null,
    transform: cleanUp,
    domain: 'happy_casa',
    schemaYAML: 'multiPages',
  },
};
