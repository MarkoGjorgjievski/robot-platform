const { cleanUp } = require('./transform.js');

module.exports = {
  implements: 'robots/san-antonio/extract',
  parameterValues: {
    country: 'SK',
    store: null,
    transform: cleanUp,
    domain: 'hornbach',
    schemaYAML: 'singlePage',
  },
};
