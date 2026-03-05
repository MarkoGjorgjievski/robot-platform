const { cleanUp } = require('./transform');

module.exports = {
  implements: 'robots/san-antonio/extract',
  parameterValues: {
    country: 'ES',
    store: null,
    transform: cleanUp,
    domain: 'seetickets',
    schemaYAML: 'singlePage',
  },
};
