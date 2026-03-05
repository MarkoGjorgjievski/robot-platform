module.exports = {
  parameterValues: {
    domain: 'tesco.com',
    country: 'UK',
    store: 'tesco',
  },
  implementation: async ({ url }, parameters, context) => {
    await context.goto(`${url}#[!opt!]{"force200": true}[/!opt!]`);
  },
};
