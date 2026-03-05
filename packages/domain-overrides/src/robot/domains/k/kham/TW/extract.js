const { cleanUp } = require('./transform.js');

module.exports = {
  implements: 'robots/san-antonio/extract',
  parameterValues: {
    country: 'TW',
    store: null,
    transform: cleanUp,
    domain: 'kham',
    schemaYAML: 'singlePage',
  },
};
