const { cleanUp } = require('./transform.js');

module.exports = {
  implements: 'robots/san-antonio/extract',
  parameterValues: {
    country: 'US',
    store: null,
    transform: cleanUp,
    domain: 'sitejabber',
    schemaYAML: 'multiPages',
  },
};
