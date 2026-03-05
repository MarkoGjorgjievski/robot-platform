module.exports = {
  implements: 'navigation/goto',
  parameterValues: {
    domain: 'kroger.com',
    country: 'US',
    store: 'kroger',
    timeout: 120000,
  },
  implementation: async ({ url, zipcode }, parameters, context, dependencies) => {
    const timeout = parameters.timeout ? parameters.timeout : 30000;
    await context.goto(url, { first_request_timeout: 60000, timeout, waitUntil: 'load', checkBlocked: true });
    console.log(zipcode);
    if (zipcode) {
      await dependencies.setZipCode({ url, zipcode });
    }
  },
};
