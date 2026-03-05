const { cleanUp } = require('./transform.js');

module.exports = {
  implements: 'robots/san-antonio/extract',
  parameterValues: {
    country: 'SE',
    store: null,
    transform: cleanUp,
    domain: 'elon',
    schemaYAML: 'multiPages',
  },
};
