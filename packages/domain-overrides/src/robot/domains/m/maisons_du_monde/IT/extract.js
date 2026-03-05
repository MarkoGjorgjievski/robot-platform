const { cleanUp } = require('./transform.js');

module.exports = {
  implements: 'robots/san-antonio/extract',
  parameterValues: {
    country: 'IT',
    store: null,
    transform: cleanUp,
    domain: 'maisons_du_monde',
    schemaYAML: 'multiPages',
  },
};
