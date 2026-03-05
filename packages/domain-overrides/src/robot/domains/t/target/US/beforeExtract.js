module.exports = {
  implements: 'robots/san-antonio/beforeExtract',
  parameterValues: {
    country: 'US',
    domain: 'target',
    schemaYAML: 'singlePage',
  },
  dependencies: { helpers: 'module:helpers/helpers' },
  implementation: async (inputs, parameters, context, dependencies) => {
    await context.evaluate((sel) => {
      document.querySelector(sel)?.scrollIntoView();
    }, "[data-test='ReviewsDashboard']");

    const { helpers: { Helpers } } = dependencies;
    const helpers = new Helpers(context);
    await helpers.waitForInDifferentContext('.syndigo_powerpage', '#ManufacturerNotes [pageid]', { timeout: 10000 });
    // await context.screenshot();
  },

};
