module.exports = {
  implements: 'navigation/goto',
  parameterValues: {
    domain: 'elcorteingles.es',
    store: 'elcorteingles',
    country: 'ES',
  },
  implementation: async ({ url }, parameters, context) => {
    await context.goto(`${url}#[!opt!]{"first_request_timeout":50000, "force200": true}[/!opt!]`, {
      block_ads: false,
      load_all_resources: true,
      images_enabled: true,
      timeout: 100000,
      waitUntil: 'load',
    });
  },
};
