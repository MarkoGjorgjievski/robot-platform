module.exports = {
  implements: 'robots/san-antonio/beforeExtract',
  parameterValues: {
    country: 'US',
    domain: 'resellerratings',
    schemaYAML: 'multiPages',
  },
  implementation: async (inputs, parameters, context, dependencies) => {
    const { helperModule: { Helpers } } = dependencies;
    const helper = new Helpers(context);
    const numberOfPages = await helper.checkAndReturnProp('//div[contains(@class,"paginate-counts")]', 'xpath', 'textContent');
    const regex = /of\s(\d+)/;
    const match = numberOfPages.match(regex);
    // eslint-disable-next-line arrow-body-style
    const pageURL = await context.evaluate(() => {
      return window.location.href;
    });
    if (match) {
      const totalNumber = +match[1];
      const totalNumberOfPages = Math.ceil(totalNumber / 15);
      await helper.addArrayToDocument('pagesArray', new Array(+totalNumberOfPages).fill(pageURL).map((url, index) => `${url}/page/${index + 1}`));
      await context.evaluate(() => {
        const div = document.createElement('div');
        div.id = 'pageURL';
        div.innerText = window.location.href;
        document.body.appendChild(div);
      });
    }
  },
};
