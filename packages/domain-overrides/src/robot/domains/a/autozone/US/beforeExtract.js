/* eslint-disable quote-props */
module.exports = {
  implements: 'robots/san-antonio/beforeExtract',
  parameterValues: {
    country: 'US',
    domain: 'autozone',
    schemaYAML: 'singlePage',
  },
  implementation: async (inputs, parameters, context, dependencies) => {
    const { helperModule: { Helpers } } = dependencies;
    const helper = new Helpers(context);
    if (inputs.schemaYAML === 'bundles') {
      const data = await helper.checkAndReturnProp('//pre', 'xpath', 'textContent');
      const parsedData = JSON.parse(data);
      console.log('data is', data);
      console.log('parsedData', parsedData);
      console.log('deals', parsedData?.deals);
      console.log('original input', inputs.originalInputs);
      const allDeals = parsedData?.deals ? { originalInputs: inputs.originalInputs, ...parsedData.deals } : { originalInputs: inputs.originalInputs };
      const dataArr = Object.values(allDeals).map(deal => JSON.stringify(deal));
      await helper.addArrayToDocument('dealsData', dataArr);
    }

    if (inputs.schemaYAML === 'categories') {
      const numberOfPages = await helper.checkAndReturnProp('(//a[contains(@data-testid,"page-button-next")]/parent::li/preceding-sibling::li)[last()]', 'xpath', 'textContent');

      // eslint-disable-next-line arrow-body-style
      const pageURL = await context.evaluate(() => {
        return window.location.href;
      });

      if (numberOfPages) {
        await helper.addArrayToDocument('pagesArray', new Array(+numberOfPages).fill(pageURL).map((url, index) => `${url}?pageNumber=${index + 1}`));
      }
      // For the second variation of pagination
      const numberOfProducts = await helper.checkAndReturnProp('//div[contains(@id,"shelf-results-container")]//div[contains(text(),"Results")]', 'xpath', 'textContent');

      if (numberOfProducts) {
        const text = numberOfProducts.textContent.trim();

        const match = text.match(/(\d+)\s*of\s*(\d+)/);

        if (match) {
          const resultsPerPage = parseInt(match[1], 10);
          const totalResults = parseInt(match[2], 10);

          // Calculate the total number of pages
          const totalPages = Math.ceil(totalResults / resultsPerPage);

          await helper.addArrayToDocument('pagesArray', new Array(+totalPages).fill(pageURL).map((url, index) => `${url}?pageNumber=${index + 1}`));
        } else {
          console.log('Could not extract numbers from text.');
        }
      } else {
        console.log('Element not found.');
      }
    }
  },
};
