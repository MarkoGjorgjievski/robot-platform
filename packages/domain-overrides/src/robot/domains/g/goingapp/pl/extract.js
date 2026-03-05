const { cleanUp } = require('./transform');

module.exports = {
  implements: 'robots/san-antonio/extract',
  parameterValues: {
    country: 'pl',
    store: null,
    transform: cleanUp,
    domain: 'goingapp',
    schemaYAML: 'singlePage',
  },
  // dependencies: {
  //   append: 'action:helpers/append',
  //   beforeExtract: 'action:robots/san-antonio/beforeExtract',
  //   dataHelper: 'module:helpers/data',
  //   singlePage: 'extraction:robots/san-antonio/domains/${domain[0:1]}/${domain}/${country}/singlePage',
  //   venuePage: 'extraction:robots/san-antonio/domains/${domain[0:1]}/${domain}/${country}/venuePage',
  //   multiPages: 'extraction:robots/san-antonio/domains/${domain[0:1]}/${domain}/${country}/multiPages',
  //   helpers: 'module:helpers/helpers',
  // },
};
