module.exports = {
  implements: 'robots/san-antonio/beforeExtract',
  parameterValues: {
    domain: 'canadian-tire',
    country: 'CA',
    schemaYAML: 'singlePage',
  },
  implementation: async (inputs, parameters, context) => {
    if (inputs.schemaYAML === 'singlePage') {
      await context.evaluate(async () => {
        const path = window.location.pathname.toLowerCase().split('.');

        const productCode = path.length > 1
          ? path[0].slice(path[0].lastIndexOf('-') + 1, path[0].length)
          : '';

        const scriptWithSubscriptionKey = Array.from(
          document.querySelectorAll('*[type="text/javascript"]'),
        ).filter(e => e?.innerText.includes('subscriptionKey'))[0].innerText;

        const subscriptionKeyRegex = /const subscriptionKey.*?(?<subscriptionKey>[\d\w]+).*/gi;

        const { groups } = subscriptionKeyRegex.exec(scriptWithSubscriptionKey);
        const subscriptionKeyValue = groups.subscriptionKey;

        if (!subscriptionKeyValue) return;

        console.log({ productCode });
        await fetch(
          `https://apim.canadiantire.ca/v1/product/api/v1/product/productFamily/${productCode}?baseStoreId=CTR&lang=en_CA&storeId=144&light=true`,
          {
            headers: {
              'Ocp-Apim-Subscription-Key': subscriptionKeyValue,
              baseStoreId: 'CTR',
              baseSiteId: 'CTR',
              'service-version': 'ctc-dev2',
              'service-client': 'ctr/web',
              'x-web-host': window.location.hostname,
              accept: 'application/json',
            },
            method: 'GET',
          },
        )
          .then(response => response.json())
          .then((data) => {
            console.log(JSON.stringify(data));
            const node = document.createElement('div');
            node.id = 'API_RESPONSE_DATA';
            node.innerText = JSON.stringify(data);
            document.body.appendChild(node);
          });
      });

      // await new Promise(resolve => setTimeout(resolve, 20000));
      await context.evaluate(async () => {
        const arrayOfURL = [];
        // get array of node to click on
        const elems = [...document.querySelectorAll('.nl-variants__variant')];
        console.log(`Elements: ${elems}`);
        // click on them all:
        for (let index = 0; index < elems.length; index += 1) {
          const elem = elems[index];
          elem.click();
          // eslint-disable-next-line no-await-in-loop
          await new Promise(resolve => setTimeout(resolve, 2000)); // wait like 2 seconds
          arrayOfURL.push(window.location.href);
        }
        // await new Promise(resolve => setTimeout(resolve, 10000));

        console.log(`URLs: ${arrayOfURL || []}`);
        // await context.saveJson('variantsArray_', array);
        const node = document.createElement('div');
        node.id = 'variantsArray_';
        node.innerText = JSON.stringify(arrayOfURL);
        document.body.appendChild(node);
      });
    }
  },
};

// https://apim.canadiantire.ca/v1/product/api/v1/product/productFamily/1591253p?baseStoreId=CTR&lang=en_CA&storeId=144&light=true
