const { cleanUp } = require('./transform');

module.exports = {
  implements: 'robots/san-antonio/extract',
  parameterValues: {
    country: 'JP',
    store: null,
    transform: cleanUp,
    domain: 'johnnys',
    schemaYAML: 'multipages',
  },
  // dependencies: {
  //   append: 'action:helpers/append',
  //   beforeExtract: 'action:robots/san-antonio/beforeExtract',
  //   dataHelper: 'module:helpers/data',
  //   singlePage: 'extraction:robots/san-antonio/domains/${domain[0:1]}/${domain}/${country}/singlePage',
  //   multiPages: 'extraction:robots/san-antonio/domains/${domain[0:1]}/${domain}/${country}/multiPages',
  //   eventUrlPage: 'extraction:robots/san-antonio/domains/${domain[0:1]}/${domain}/${country}/eventUrlPage',
  //   helpers: 'module:helpers/helpers',
  // },
};
