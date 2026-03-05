const { cleanUp } = require('./transform.js');

module.exports = {
  implements: 'robots/san-antonio/extract',
  parameterValues: {
    country: 'BR',
    store: null,
    transform: cleanUp,
    domain: 'blueticket',
    schemaYAML: 'singlePage',
  },
};
