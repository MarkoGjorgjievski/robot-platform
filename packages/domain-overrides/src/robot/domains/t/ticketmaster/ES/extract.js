const { transformation } = require('./transform');

module.exports = {
  implements: 'robots/san-antonio/extract',
  parameterValues: {
    country: 'ES',
    store: null,
    transform: transformation,
    domain: 'ticketmaster',
    schemaYAML: 'singlePage',
  },
};
