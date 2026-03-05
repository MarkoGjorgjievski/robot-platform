module.exports = {
  implements: 'robots/san-antonio/beforeExtract',
  parameterValues: {
    country: 'US',
    domain: 'dillards',
    schemaYAML: 'navSeq1',
  },
  // eslint-disable-next-line sonarjs/cognitive-complexity
  implementation: async (inputs, parameters, context, dependencies) => {
    const { helperModule: { Helpers }, goto2, processActions } = dependencies;
    const helper = new Helpers(context);

    if (inputs.originalInputs?.vnd1 && inputs.originalInputs?.vnd1?.length) {
      console.log('>>>>>>   SEQUENCE 1. VENDOR FOUND IN INPUT   <<<<<<');
      if (await helper.checkXpathSelector('//*[contains(text(),"Something went wrong")]')) {
        await context.evaluate(() => {
          const div = document.createElement('div');
          div.setAttribute('id', 'srchStatus');
          div.setAttribute('text', 'Invalid Login');
          document.body.appendChild(div);
        });
      }
      if (await helper.checkXpathSelector('//*[contains(text(),"Welcome to the new eBiz")]')) {
        await goto2({ ...inputs, url: 'https://ebiz.dillards.com/AccountsPayable/search' });
      }
      if (await helper.checkXpathSelector('//label[contains(text(),"Inquiry Type")]')) {
        await processActions({
          inputs,
          actions: [
            {
              selectorOrXpath: '//label[@for="Invoice"]',
              wait: 1000,
            },
            {
              selectorOrXpath: '[id="vendorDropdown1"]',
              wait: 1000,
            },
          ],
        });
      }

      if (await helper.checkXpathSelector('//button[@aria-expanded="true"]')) {
        const textValue = inputs.originalInputs.vnd1.trim().split(' ')[0];
        await context.evaluate((text) => {
          const buttons = document.querySelectorAll('div[aria-labelledby="vendorDropdown"] button');
          buttons.forEach((button) => {
            if (button.textContent.includes(text)) {
              // @ts-ignore
              button.click();
            }
          });
        }, textValue);

        if (await helper.checkXpathSelector('//*[contains(text(),"Vendor Number Required")]')) {
          console.log(`>>>>>>VENDOR "${inputs.originalInputs.vnd1}" IS NOT IN THE DROPDOWN<<<<<<`);
          await context.evaluate(() => {
            const div = document.createElement('div');
            div.setAttribute('id', 'srchStatus');
            div.setAttribute('text', 'Vendor Not Found');
            document.body.appendChild(div);
          });
        }
      }

      if (!await helper.checkXpathSelector('//*[contains(text(),"Vendor Number Required")]')) {
        await processActions({
          inputs,
          actions: [
            {
              selectorOrXpath: '#invoiceNumber',
              inputValue: '{invNo}',
              wait: 3000,
            },
          ],
        });
      }
      await context.evaluate(() => {
        const button = document.querySelector('button[type="submit"]');
        // @ts-ignore
        button.click();
      });
      await new Promise(resolve => setTimeout(resolve, 10000));

      if (await helper.checkXpathSelector('//*[contains(text(),"no search results were found")]')) {
        await context.evaluate(() => {
          const div = document.createElement('div');
          div.setAttribute('id', 'srchStatus');
          div.setAttribute('text', 'Invoice Not Found');
          document.body.appendChild(div);
        });
      }

      if (await helper.checkXpathSelector('//*[contains(@id,"invoice-list")]')) {
        await processActions({
          inputs,
          actions: [
            {
              selectorOrXpath: '//*[contains(@id,"invoice-list")]//tr[contains(@class,"clickable")]',
              wait: 3000,
            },
          ],
        });
      }
      if (await helper.checkXpathSelector('//*[contains(text(),"Invoice Activity")]')) {
        await context.evaluate(() => {
          const div = document.createElement('div');
          div.setAttribute('id', 'srchStatus');
          div.setAttribute('text', 'Invoice Found');
          document.body.appendChild(div);
        });
      }
    }
  },
};
