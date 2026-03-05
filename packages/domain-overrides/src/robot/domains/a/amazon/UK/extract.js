const { cleanUp } = require('./transform');

module.exports = {
  implements: 'robots/san-antonio/extract',
  parameterValues: {
    country: 'UK',
    store: null,
    transform: cleanUp,
    domain: 'amazon',
    schemaYAML: 'multiPages',
  },
  dependencies: {
    append: 'action:helpers/append',
    beforeExtract: 'action:robots/san-antonio/beforeExtract',
    dataHelper: 'module:helpers/data',
    singlePage: 'extraction:robots/san-antonio/domains/${domain[0:1]}/${domain}/${country}/singlePage',
    multiPages: 'extraction:robots/san-antonio/domains/${domain[0:1]}/${domain}/${country}/multiPages',
    reviews: 'extraction:robots/san-antonio/domains/${domain[0:1]}/${domain}/${country}/reviews',
    helpers: 'module:helpers/helpers',
  },
};
