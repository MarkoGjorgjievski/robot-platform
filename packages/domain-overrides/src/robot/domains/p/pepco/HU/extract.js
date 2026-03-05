const { cleanUp } = require('./transform.js');

module.exports = {
  implements: 'robots/san-antonio/extract',
  parameterValues: {
    country: 'HU',
    store: null,
    transform: cleanUp,
    domain: 'pepco',
    schemaYAML: 'multiPages',
  },
};
