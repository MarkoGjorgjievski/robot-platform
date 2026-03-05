/* eslint-disable no-console */
module.exports = {
  implements: 'robots/san-antonio/beforeExtract',
  parameterValues: {
    domain: 'nisbets',
    country: 'UK',
    schemaYAML: 'extractor',
  },

  dependencies: { processActions: 'action:helpers/processActions', helperModule: 'module:helpers/helpers' },
  implementation: async (inputs, parameters, context, dependencies) => {
    const { processActions } = dependencies;
    const { log } = console;
    console.log = () => {};

    const { productListingsPage, categoryListingsPage, paginationAvailable } = await context.evaluate(() => ({
      paginationAvailable: !!document.querySelector('div.pagination-container a'),
      productListingsPage: !!document.evaluate('//div[@id="product-results-list"][//*[contains(@class,"product-list-grid-item") and (contains(@class, "default-item") or contains(@class, "parent-item"))]]', document.body, null, XPathResult.ANY_TYPE, null).iterateNext(),
      categoryListingsPage: !!document.evaluate('//ul[contains(@class, "brand-index__list")]/li', document.body, null, XPathResult.ANY_TYPE, null).iterateNext(),
    }));

    if (categoryListingsPage) {
      log('ok to extract category');
      await context.evaluate(() => {
        document.querySelector('ul.brand-index__list').setAttribute('id', 'cat');
      });
    } else if (productListingsPage && !inputs.url.includes('?show=ALL')) {
      await context.evaluate((url) => {
        const div = document.createElement('div');
        const a = document.createElement('a');
        div.setAttribute('id', 'showAll');
        a.setAttribute('href', `${url.replace('https://www.nisbets.co.uk', '')}?show=ALL`);
        div.appendChild(a);
        document.body.appendChild(div);
      }, inputs.url);
    } else if (productListingsPage && inputs.url.includes('?show=ALL')) {
      if (paginationAvailable && !inputs.url.includes('currentPage')) {
        await context.evaluate((input) => {
          Array.from(
            Array(Math.ceil(parseInt(document.querySelectorAll('div.pagination-container a.page')[document.querySelectorAll('div.pagination-container a.page').length - 1].textContent, 10) / 200)).keys(),
          ).map((page, i) => `${input}&currentPage=${i}`).forEach((url) => {
            const div = document.createElement('div');
            const a = document.createElement('a');
            div.setAttribute('id', 'showAll');
            a.setAttribute('href', url);
            div.appendChild(a);
            document.body.appendChild(div);
          });
        }, inputs.url);
      } else {
        await context.evaluate(() => {
          document.getElementById('product-results-list').setAttribute('name', 'import');
        });
      }
    }

    await processActions({ inputs, actions: [{ selectorOrXpath: 'button[aria-label="productView.listView"]', wait: 2500 }] });
    // await helper.optionalWait(waitForXPathToLoad, loadingTimeout, 'XPATH');

    // try on nightmare

    // const clicked = await context.evaluate(async () => {
    //   const listView = document.querySelector('button[aria-label="productView.listView"]');
    //   if (listView && listView instanceof HTMLButtonElement) {
    //     listView.click();
    //     await new Promise(res => setTimeout(res, 2000));
    //     return true;
    //   }
    //   return false;
    // });
    // // if (clicked) {
    // log('list button clicked', clicked);
    // await context.evaluate(async () => new Promise(res => setTimeout(res, 2000)));
    //   await new Promise(resolve => setTimeout(resolve, 2000));
    //   log('waiting done');
    // } else {
    //   log('list button not clicked');
    // }
  },
};
