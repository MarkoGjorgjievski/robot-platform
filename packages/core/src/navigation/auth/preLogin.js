module.exports = {
  parameters: [
    {
      name: 'domain',
      description: '',
      optional: false,
    },
  ],
  inputs: [],
  dependencies: {},
  path: './domains/${domain[0:2]}/${domain}/preLogin',
};
