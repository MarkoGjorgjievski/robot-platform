const { cleanUp } = require('./transform.js');

module.exports = {
  implements: 'robots/san-antonio/extract',
  parameterValues: {
    country: 'CL',
    store: null,
    transform: cleanUp,
    domain: 'putntoticket',
    schemaYAML: 'singlePage',
  },
};
