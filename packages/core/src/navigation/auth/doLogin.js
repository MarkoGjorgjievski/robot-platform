/**
 *
 * @param { { username: string, password: string } } inputs
 * @param { { domain: any, usernameSelector: string, passwordSelector: string, buttonSelector: string, formSelector: string, loggedInSelector: string } } parameters
 * @param { ImportIO.IContext } context
 * @param { { someAction: ImportIO.Action, someFunction: () => void, someExtraction: string } } dependencies
 */
async function implementation(
  inputs,
  parameters,
  context,
) {
  const { username, password } = inputs;
  const {
    usernameSelector, passwordSelector, buttonSelector, formSelector, loggedInSelector,
  } = parameters;

  await context.setInputValue(usernameSelector, username);
  await context.setInputValue(passwordSelector, password);
  if (buttonSelector) {
    await context.click(buttonSelector);
  }

  if (formSelector) {
    await context.evaluate(() => {
      // @ts-ignore
      document.querySelector(formSelector)?.submit();
    });
  }

  if (loggedInSelector) {
    await context.waitForFunction(sel => Boolean(document.querySelector(sel)), { timeout: 10000 }, loggedInSelector);
  }
}

module.exports = {
  parameters: [
    {
      name: 'domain',
      description: 'domain of target website',
      optional: false,
    },
    {
      name: 'usernameSelector',
      description: '',
      optional: false,
    },
    {
      name: 'passwordSelector',
      description: '',
      optional: false,
    },
    {
      name: 'buttonSelector',
      description: '',
      optional: false,
    },
    {
      name: 'loggedInSelector',
      description: '',
      optional: true,
    },
  ],
  inputs: [
    {
      name: 'username',
      description: '',
      type: 'string',
      optional: false,
    },
    {
      name: 'password',
      description: '',
      type: 'string',
      optional: false,
    },
  ],
  dependencies: {},
  path: './domains/${domain[0:2]}/${domain}/doLogin',
  implementation,
};
