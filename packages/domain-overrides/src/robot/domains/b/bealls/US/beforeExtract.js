module.exports = {
  implements: 'robots/san-antonio/beforeExtract',
  parameterValues: {
    country: 'US',
    domain: 'bealls',
    schemaYAML: 'singlePage',
  },
  implementation: async (inputs, parameters, context, dependencies) => {
    const { helperModule: { Helpers }, processActions } = dependencies;
    const helper = new Helpers(context);
    if (await helper.checkXpathSelector('//input[contains(@id,"UserId")]')) {
      await processActions({
        inputs,
        actions: [
          {
            selectorOrXpath: '//input[contains(@id,"UserId")]',
            inputValue: '{siteUsr}',
            wait: 100,
          },
          {
            selectorOrXpath: '//input[contains(@id,"Password")]',
            inputValue: '{sitePwd}',
            wait: 100,
          },
          {
            selectorOrXpath: '//input[contains(@id,"btnLogin")]',
            wait: 10000,
          },
        ],
      });
    }
    if (await helper.checkXpathSelector('//div[contains(@class,"alert")]')) {
      await context.evaluate(() => {
        const statusContainer = document.createElement('div');
        statusContainer.id = 'notFound';
        statusContainer.textContent = 'Invalid Login';
        document.body.appendChild(statusContainer);
        return false;
      });
    }

    if (await helper.checkXpathSelector('//select[contains(@id,"dunsoptions")]')) {
      const textValue = inputs.originalInputs.vnd1.split(' ')[0];
      await context.evaluate((textValueData) => {
        const dropdown = document.querySelector('select[id="dunsoptions"]');
        if (!dropdown) {
          console.log('Dropdown not found');
          return false;
        }
        // @ts-ignore
        const optionsArray = Array.from(dropdown.options).map(opt => opt.text);
        console.log('array from options', optionsArray);
        // @ts-ignore
        const desiredValue = Array.from(dropdown.options).find(({ value }) => value === textValueData);

        if (!desiredValue) {
          console.log(`Option containing '${textValueData}' not found`);
          const statusContainer = document.createElement('div');
          statusContainer.id = 'notFound';
          statusContainer.textContent = 'Dropdown Mismatch';
          document.body.appendChild(statusContainer);
          return false;
        }
        console.log(`Option containing '${textValueData}' was found: ${desiredValue}`);
        // @ts-ignore
        dropdown.value = desiredValue.value;
        const event = new Event('change', { bubbles: true });
        dropdown.dispatchEvent(event);
        return true;
      }, textValue);
      await new Promise(resolve => setTimeout(resolve, 5000));
      await processActions({
        inputs,
        actions: [
          {
            selectorOrXpath: '//input[contains(@id,"invoiceOrDm")]',
            inputValue: '{invNo}',
            wait: 500,
          },
          {
            selectorOrXpath: '//input[contains(@id,"btnSearch")]',
            wait: 15000,
          },
        ],
      });
    }
  },
};
