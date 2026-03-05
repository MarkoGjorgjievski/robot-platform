// @ts-nocheck
module.exports = {
  implements: 'robots/san-antonio/beforeExtract',
  parameterValues: {
    country: 'US',
    domain: 'drinkcantrip',
    schemaYAML: 'details',
  },
  implementation: async (inputs, parameters, context) => {
    async function setInputValue(selector, value) {
      return context.evaluate(({ selectorData, valueData }) => {
        const iframe = document.querySelector('div[data-pf-type="Custom.HTML"] > *');
        if (!iframe) {
          console.log('iframe cannot be accessed');
          return false;
        }

        // @ts-ignore
        const inputElement = iframe.contentDocument.querySelector(selectorData);
        if (!inputElement) {
          console.log(`Input with selector '${selectorData}' not found`);
          return false;
        }

        inputElement.value = valueData;
        inputElement.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      }, { selectorData: selector, valueData: value });
    }

    async function clickButton(xpath) {
      return context.evaluate(({ xpathData }) => {
        const iframe = document.querySelector('div[data-pf-type="Custom.HTML"] > *');
        if (!iframe) {
          console.log('iframe cannot be accessed');
          return false;
        }

        const buttonElement = iframe.contentDocument.evaluate(xpathData, iframe.contentDocument, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
        if (!buttonElement) {
          console.log(`Button with XPath '${xpathData}' not found`);
          return false;
        }

        buttonElement.click();
        console.log('Button clicked.');
        return true;
      }, { xpathData: xpath });
    }
    // await context.reload();
    // await context.evaluate(() => {
    //   fetch('https://finder.vtinfo.com/finder/web/v2/iframe?custID=T0S&UUID=iHdhigv9YprlFGxknaGP2gdmAKQZcYZDh5e5', { method: 'GET' })
    //     .then(response => response.json())
    //     .then(data => console.log('data', data))
    //     .catch(error => console.error('Error:', error));
    // });
    await context.evaluate(() => {
      fetch('https://example.com/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          custID: 'T0S',
          pagesize: 40,
          UUID: 'iHdhigv9YprlFGxknaGP2gdmAKQZcYZDh5e5',
          implementationID: 2166,
          minResults: '',
          minSold: '',
          action: 'results',
          d: ['10001', 'New York, NY 10001, USA'],
          m: 10,
          storeType: '',
          themeVersion: 3,
          onPremDescription: 'Restaurants and Bars',
          offPremDescription: 'Retail Stores',
          z: 10001,
          city: 'New York',
          county: '',
          state: 'NY',
          lat: 40.75369,
          long: -73.99916,
          CSRFToken: 'i4q+C7LJSphQ6wS182iLSQ7b+udhtin0zPTeLSjZI4XhbF4SoPIwiqRwCENI9tbQ8H4InJ3U9zTvYPN/OQwkwVLaEI0+2FtCj5cO4PdIpLdZGmWr/9lfi5Ydg228zY2WhonlhPA=,bFQkP0ZCUyzb4WNz',
        }),
      })
        .then(response => response.json())
        .then(data => console.log(data))
        .catch(error => console.error('Error:', error));
    });
    await new Promise(resolve => setTimeout(resolve, 15000));
    await setInputValue('input[id="finder_address"]', inputs.originalInputs?.zip);
    await clickButton('//input[contains(@id,"submitBtn")]');
    // const res = await context?.searchForRequest('iframe/search')?.then(result => console.log('result from request', result));
    // console.log(res)
    // if (res !== undefined) await context.saveJson('requestData', res);
  },
};
