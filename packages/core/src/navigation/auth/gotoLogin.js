/**
 *
 * @param { { domain: any, loginPage: string } } parameters
 * @param { ImportIO.IContext } context
 * @param { { goto: ImportIO.Action, preLogin: ImportIO.Action, doLogin: ImportIO.Action, postLogin: ImportIO.Action, } } dependencies
 */
async function implementation(
  inputs,
  parameters,
  context,
  dependencies,
) {
  const { loginPage } = parameters;

  await dependencies.goto({ url: loginPage });
}

module.exports = {
  parameters: [
    {
      name: 'domain',
      description: '',
      optional: false,
    },
    {
      name: 'loginPage',
      description: '',
      optional: false,
    },
  ],
  inputs: [
  ],
  dependencies: { goto: 'action:navigation/goto' },
  path: './domains/${domain[0:2]}/${domain}/gotoLogin',
  implementation,
};
