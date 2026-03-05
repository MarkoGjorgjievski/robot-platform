module.exports = {
  implements: 'navigation/goto',
  parameterValues: {
    domain: 'fwrd.com',
    timeout: null,
    country: 'US',
    store: 'fwrd',
    zipcode: '',
  },
  implementation: async (inputs, parameters, context, dependencies) => {
    const timeout = parameters.timeout ? parameters.timeout : 10000;
    const { url, zipcode, storeId } = inputs;
    await context.goto(url, { timeout, waitUntil: 'load', checkBlocked: true });
    console.log(zipcode);
    if (zipcode || storeId) {
      await dependencies.setZipCode(inputs);
    }

    try {
      const cssOverLay = 'body.body--modal-overflow-hidden div.modal__content-main a.js-modal-close span';
      await context.waitForFunction((selector) => {
        console.log(selector, document.querySelector(selector));
        return Boolean(document.querySelector(selector));
      }, { timeout: 5000 }, cssOverLay);
      console.log('Overlay Found!!!');
      await context.click(cssOverLay);
      await new Promise(resolve => setTimeout(resolve, 2000));
    } catch (error) {
      console.log('Overlay NOT Found');
    }
  },
};
