module.exports = {
  implements: 'robots/san-antonio/beforeExtract',
  parameterValues: {
    country: 'DE',
    domain: 'amazon',
    schemaYAML: 'multiPages',
  },
  implementation: async (inputs, parameters, context) => {
    if (inputs.schemaYAML === 'details') {
      // eslint-disable-next-line consistent-return
      const foundViscosity = await context.evaluate(() => {
        const viscosityXpath = "//span[contains(text(),'Viscosity')]/parent::td/following-sibling::td";
        const viscosityXpathBackup = "//span[contains(text(),'Viskosität')]/parent::td/following-sibling::td";
        const result = document.evaluate(viscosityXpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
        const resultBackup = document.evaluate(viscosityXpathBackup, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
        const viscosityRegex = / (.*?)\s*\d+\s*[wW]\s*-?\s*\d+/gm;
        const titleElement = document.querySelector('#productTitle');
        const title = titleElement.textContent || '';
        const matchedValue = title.match(viscosityRegex);
        return !!(matchedValue || result || resultBackup);
      });

      if (!foundViscosity) {
        await context.halt(true);
      }
    }
  },
};
