module.exports = {

  implements: 'navigation/goto',

  parameterValues: {
    domain: 'grocery.walmart.com',
    country: 'US',
    store: 'walmartOG',
  },

  implementation: async ({ url, zipcode }, parameterValues, context, dependencies) => {
    // USING OPT TAGS > anti_fingerprint), to avoid blocking
    // #[!opt!]{"anti_fingerprint":false}[/!opt!]

    if (zipcode) {
      await dependencies.setZipCode({ zipcode });
    }

    const inputUrl = `${url}`;
    await context.goto(inputUrl, { timeout: 30000, waitUntil: 'load', checkBlocked: false });
  },
};
