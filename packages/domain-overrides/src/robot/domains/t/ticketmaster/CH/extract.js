const { cleanUp } = require('./transform');

module.exports = {
  implements: 'robots/san-antonio/extract',
  parameterValues: {
    country: 'CH',
    store: null,
    transform: cleanUp,
    domain: 'ticketmaster',
    schemaYAML: 'singlePage',
  },
};
