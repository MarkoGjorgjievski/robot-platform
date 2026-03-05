const { cleanUp } = require('./transform');

module.exports = {
  implements: 'robots/san-antonio/extract',
  parameterValues: {
    country: 'ID',
    store: null,
    transform: cleanUp,
    domain: 'lazada',
    schemaYAML: 'multiPages',
  },
};
