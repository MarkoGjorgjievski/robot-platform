/* eslint-disable no-console */
module.exports = {
  implements: 'robots/san-antonio/beforeExtract',
  parameterValues: {
    domain: 'bunzlchs',
    country: 'UK',
    schemaYAML: 'extractor',
  },
  dependencies: { helpers: 'module:helpers/helpers' },
};
