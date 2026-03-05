module.exports = {
  parameters: [
    {
      name: 'domain',
      description: 'The top private domain of the website (e.g. amazon.com)',
    },
    {
      name: 'timeout',
      description: 'Timeout for loading',
      type: 'number',
      optional: true,
    },
    {
      name: 'jsonToTable',
      description: 'will check if the json collected is properly parsed into a table',
      type: 'boolean',
      optional: true,
    },
  ],
  inputs: [
    {
      name: 'url',
      description: 'The URL to go to',
      type: 'string',
    },
    {
      name: 'zipcode',
      description: 'Set location ',
      type: 'string',
    },
    {
      name: 'storeId',
      description: 'storeId for product',
      type: 'string',
      optional: true,
    },
  ],
  dependencies: { setZipCode: 'action:navigation/goto/setZipCode' },
  path: './goto/domains/${domain[0:2]}/${domain}',
  implementation: async (inputs, parameters, context, dependencies) => {
    const { timeout = 10000 } = parameters;
    const { url, zipcode, storeId } = inputs;
    await context.goto(url, { timeout, waitUntil: 'load', checkBlocked: true, captureRequests: true });

    // patch for synchronicity issue between json decoring and goto result
    if (url.split('[!opt!]')[1] && url.split('[!opt!]')[1].includes('"type":"json"')) {
      await new Promise(resolve => setTimeout(resolve, 5000));
    }

    console.log(`zipcode: ${zipcode}`);
    if (zipcode || storeId) {
      await dependencies.setZipCode(inputs);
    }
  },
};
//
