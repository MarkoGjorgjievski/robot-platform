const { cleanUp } = require('./transform');

module.exports = {
  implements: 'robots/san-antonio/extract',
  parameterValues: {
    country: 'NO',
    store: null,
    transform: cleanUp,
    domain: 'eventim',
    schemaYAML: 'multiPages',
  },
};
