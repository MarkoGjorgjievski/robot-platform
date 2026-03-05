module.exports = {
  implements: 'robots/san-antonio/beforeExtract',
  parameterValues: {
    country: 'US',
    domain: 'walmart',
    schemaYAML: 'multiPages',
  },
  // TODO: compare with Amazon US, adjust to walmart, test on inputs with NaN from the following drilldown:
  // https://workbench.import.io/orgs/bp/projects/ecom/collections/details2/sources/walmart_us_ddf_494/snapshots/bd23253a-4be6-5582-9087-13783b949d73/drilldown#sql=SELECT%20*%20FROM%20S3Object%20s%20where%20%22packSize%22%20%3D%20'NaN'%20and%20not%20(%22productName%22%20like%20'%25Filter%25')%20LIMIT%2020000%0A%0A
  implementation: async (inputs, parameters, context, dependencies) => {
    if (inputs.schemaYAML === 'firstVariantPage') {
      // eslint-disable-next-line consistent-return
      const blacklisted = await context.evaluate(() => {
        const blackList = [/filter/i, /oil stabilizer/i, /marine oil/i, /race oil/, /transmission fluid/i];
        const titleElement = document.querySelector('h1');
        const title = titleElement.textContent || '';
        return blackList.some(reg => title.match(reg));
      });

      const containsOil = await context.evaluate(() => {
        const descriptionElement = document.querySelector('#product-description-atf');
        const description = descriptionElement?.textContent || '';
        return description.match(/\d+W-?\d+/i);
      });

      if (!containsOil && blacklisted) {
        await context.halt(true);
      }
    }
    if (inputs.schemaYAML === 'screenshot') {
      const { helperModule: { Helpers } } = dependencies;
      // @ts-ignore
      // eslint-disable-next-line no-unused-vars
      const helper = new Helpers(context);
      const input = inputs.originalInputs;

      // eslint-disable-next-line no-shadow
      await context.evaluate((input) => {
        const newInputs = { ...input, RETAILER_URL: window.location.href, timestamp: new Date().toISOString() };
        const inputsContainer = document.createElement('div');
        inputsContainer.id = 'inputs-container';
        // eslint-disable-next-line no-restricted-syntax
        for (const [key, value] of Object.entries(newInputs)) {
          if (!key.includes('_url') && !key.includes('robots') && !key.includes('url')) {
            const item = document.createElement('div');
            item.textContent = `${key}: ${value}`; // Date.now.toISOstring
            inputsContainer.appendChild(item);
          }
        }
        document.body.insertBefore(inputsContainer, document.body.firstChild);
      }, input);
    }
  },
};
