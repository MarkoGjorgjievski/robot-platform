const { cleanUp } = require('./transform.js');

module.exports = {
  implements: 'robots/san-antonio/extract',
  parameterValues: {
    country: 'SK',
    store: null,
    transform: cleanUp,
    domain: 'predpredaj',
    schemaYAML: 'multiPages',
  },
  dependencies: {
    append: 'action:helpers/append',
    beforeExtract: 'action:robots/san-antonio/beforeExtract',
    dataHelper: 'module:helpers/data',
    singlePage: 'extraction:robots/san-antonio/domains/${domain[0:1]}/${domain}/${country}/singlePage',
    multiPages: 'extraction:robots/san-antonio/domains/${domain[0:1]}/${domain}/${country}/multiPages',
    datesPages: 'extraction:robots/san-antonio/domains/${domain[0:1]}/${domain}/${country}/datesPages',
    helpers: 'module:helpers/helpers',
  },
};
