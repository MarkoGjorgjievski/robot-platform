const { cleanUp } = require('./transform');

module.exports = {
  implements: 'robots/san-antonio/extract',
  parameterValues: {
    country: 'pt',
    store: null,
    transform: cleanUp,
    domain: 'ticketline',
    schemaYAML: 'singlePage',
  },
};
