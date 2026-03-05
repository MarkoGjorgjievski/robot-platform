const { cleanUp } = require('./transform');

module.exports = {
  implements: 'robots/san-antonio/extract',
  parameterValues: {
    country: 'US',
    store: null,
    transform: cleanUp,
    domain: 'frontgate',
    schemaYAML: 'singlePage',
  },
  dependencies: {
    append: 'action:helpers/append',
    beforeExtract: 'action:robots/san-antonio/beforeExtract',
    dataHelper: 'module:helpers/data',
    singlePage: 'extraction:robots/san-antonio/domains/${domain[0:1]}/${domain}/${country}/singlePage',
    multiPages: 'extraction:robots/san-antonio/domains/${domain[0:1]}/${domain}/${country}/multiPages',
    firstDepth: 'extraction:robots/san-antonio/domains/${domain[0:1]}/${domain}/${country}/firstDepth',
    helpers: 'module:helpers/helpers',
  },
};
