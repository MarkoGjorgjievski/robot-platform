const { cleanUp } = require('./transform.js');

module.exports = {
  implements: 'robots/san-antonio/extract',
  parameterValues: {
    country: 'JP',
    store: null,
    transform: cleanUp,
    domain: 'eplus',
    schemaYAML: 'multiPages',
  },
  dependencies: {
    append: 'action:helpers/append',
    beforeExtract: 'action:robots/san-antonio/beforeExtract',
    dataHelper: 'module:helpers/data',
    singlePage: 'extraction:robots/san-antonio/domains/${domain[0:1]}/${domain}/${country}/singlePage',
    multiPages: 'extraction:robots/san-antonio/domains/${domain[0:1]}/${domain}/${country}/multiPages',
    eventData: 'extraction:robots/san-antonio/domains/${domain[0:1]}/${domain}/${country}/eventData',
    venueData: 'extraction:robots/san-antonio/domains/${domain[0:1]}/${domain}/${country}/venueData',
    helpers: 'module:helpers/helpers',
  },
};
