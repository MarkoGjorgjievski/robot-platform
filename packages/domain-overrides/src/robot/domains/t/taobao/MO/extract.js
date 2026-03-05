const { cleanUp } = require('./transform');

module.exports = {
  implements: 'robots/san-antonio/extract',
  parameterValues: {
    country: 'MO',
    store: null,
    transform: cleanUp,
    domain: 'taobao',
    schemaYAML: 'multiPages',
  },
};
