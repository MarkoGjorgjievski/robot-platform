module.exports = {
  implements: 'navigation/goto',
  parameterValues: {
    domain: 'costco.com',
    country: 'US',
    store: 'costco',
    zipcode: '98188',
  },
  implementation: async ({ url, zipcode }, parameters, context) => {
    let newUrl;
    if (zipcode) {
      newUrl = `${url}#[!opt!]{"first_request_timeout":50000, "force200": true, "cookie_jar":[{"name":"invCheckPostalCode","value":${zipcode}}]}[/!opt!]`;
    } else {
      newUrl = `${url}#[!opt!]{"first_request_timeout":50000, "force200": true}[/!opt!]`;
    }
    await context.goto(newUrl, {
      block_ads: false,
      load_all_resources: true,
      images_enabled: true,
      timeout: 50000,
      waitUntil: 'load',
    });
    await context.waitForNavigation();
  },
};
