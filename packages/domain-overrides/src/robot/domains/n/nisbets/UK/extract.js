const { cleanUp } = require('./transform.js');

module.exports = {
  implements: 'robots/san-antonio/extract',
  parameterValues: {
    country: 'UK',
    store: null,
    transform: cleanUp,
    domain: 'nisbets',
    schemaYAML: 'extractor',
  },
};
