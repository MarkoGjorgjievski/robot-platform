module.exports = {
  implements: 'robots/san-antonio/beforeExtract',
  parameterValues: {
    country: 'US',
    domain: 'potoo_screenshot',
    schemaYAML: 'singlePage',
  },
  implementation: async (inputs, parameters, context, dependencies) => {
    const { helperModule: { Helpers } } = dependencies;
    // @ts-ignore
    // eslint-disable-next-line no-unused-vars
    const helper = new Helpers(context);
    const input = inputs.originalInputs;
    // eslint-disable-next-line no-shadow
    await context.evaluate((input) => {
      // Create a container for the inputs
      const newInputs = { ...input, RETAILER_URL: window.location.href, timestamp: new Date().toISOString() };
      const inputsContainer = document.createElement('div');
      inputsContainer.id = 'inputs-container';
      // Create and append elements for each input
      // eslint-disable-next-line no-restricted-syntax
      for (const [key, value] of Object.entries(newInputs)) {
        if (!key.includes('_url') && !key.includes('robots') && !key.includes('url')) {
          const item = document.createElement('div');
          item.textContent = `${key}: ${value}`; // Date.now.toISOstring
          inputsContainer.appendChild(item);
        }
      }
      // Insert the container before the body tag
      document.body.insertBefore(inputsContainer, document.body.firstChild);
    }, input);
    await context.evaluate(() => {
      window.scrollTo(0, 0);
    });
    await new Promise(resolve => setTimeout(resolve, 5000));
    // await helper.ifThereClickOnIt('#inputs-container');
    // await new Promise(resolve => setTimeout(resolve, 5000));
  },
};
