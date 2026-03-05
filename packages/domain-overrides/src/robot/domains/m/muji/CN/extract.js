const { cleanUp } = require('./transform.js');

module.exports = {
  implements: 'robots/san-antonio/extract',
  parameterValues: {
    country: 'CN',
    store: null,
    transform: cleanUp,
    domain: 'muji',
    schemaYAML: 'multiPages',
  },
};
