/**
 *
 * @param { { _credentials: any } } inputs
 * @param { { domain: any, loginPage: string } } parameters
 * @param { ImportIO.IContext } context
 * @param { { gotoLogin: ImportIO.Action, preLogin: ImportIO.Action, doLogin: ImportIO.Action, postLogin: ImportIO.Action, } } dependencies
 */
async function implementation(
  inputs,
  parameters,
  context,
  dependencies,
) {
  const { _credentials } = inputs;
  const credentials = _credentials || {};

  await dependencies.gotoLogin({});
  await dependencies.preLogin(credentials);
  await dependencies.doLogin(credentials);
  await dependencies.postLogin(credentials);

  console.log('Logged in!');
}

module.exports = {
  parameters: [
    {
      name: 'domain',
      description: '',
      optional: false,
    },
  ],
  inputs: [
    {
      name: '_credentials',
      description: '',
      type: 'string',
      optional: false,
    },
  ],
  dependencies: {
    gotoLogin: 'action:navigation/auth/gotoLogin',
    preLogin: 'action:navigation/auth/preLogin',
    postLogin: 'action:navigation/auth/postLogin',
    doLogin: 'action:navigation/auth/doLogin',
  },
  path: './domains/${domain[0:2]}/${domain}/authenticate',
  implementation,
};
