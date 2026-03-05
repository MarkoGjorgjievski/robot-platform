module.exports = {
  implements: 'robots/san-antonio/beforeExtract',
  parameterValues: {
    country: 'UK',
    domain: 'farnell',
    schemaYAML: 'multiPages',
  },
  implementation: async (inputs, parameters, context, dependencies) => {
    const { helperModule: { Helpers } } = dependencies;
    const helper = new Helpers(context);
    const numberOfPages = await helper.checkAndReturnProp('//span[contains(@class,"pagination__text") and not(contains(@class,"pagination__items-count"))]', 'xpath', 'textContent');
    const pagesNumber = numberOfPages.match(/\d+/)?.[0];
    // eslint-disable-next-line arrow-body-style
    const pageURL = await context.evaluate(() => {
      return window.location.href;
    });
    await helper.addArrayToDocument('pagesArray', new Array(+pagesNumber).fill(pageURL).map((url, index) => `${url}/${index + 1}`));
  },
};
