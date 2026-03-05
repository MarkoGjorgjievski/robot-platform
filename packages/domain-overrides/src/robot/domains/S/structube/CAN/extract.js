const { cleanUp } = require('./transform.js');

module.exports = {
  implements: 'robots/san-antonio/extract',
  parameterValues: {
    country: 'CAN',
    store: null,
    transform: cleanUp,
    domain: 'structube',
    schemaYAML: 'multiPages',
  },
};
