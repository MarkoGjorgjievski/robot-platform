const { cleanUp } = require('./transform');

module.exports = {
  implements: 'robots/san-antonio/extract',
  parameterValues: {
    country: 'CZ',
    store: null,
    transform: cleanUp,
    domain: 'ticketportal',
    schemaYAML: 'singlePage',
  },
};
