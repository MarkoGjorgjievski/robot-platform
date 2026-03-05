module.exports = {
  implements: 'robots/san-antonio/beforeExtract',
  parameterValues: {
    country: 'US',
    domain: 'nordstrom',
    schemaYAML: 'multiPages',
  },
  implementation: async (inputs, parameters, context, dependencies) => {
    const { helperModule: { Helpers }, processActions } = dependencies;
    const helper = new Helpers(context);
    const iFrameSelector = 'td > [aria-label]:first-child';
    async function selectDropdownOption(selector, textValue, isIframe = false) {
      return context.evaluate((selectorData, textValueData, isIframeData, iFrameSelectorData) => {
        const iframe = document.querySelector(iFrameSelectorData);
        // @ts-ignore
        if (isIframeData && !iframe.contentDocument) {
          console.log('iframe cannot be accesed');
          return false;
        }
        // @ts-ignore
        const dropdown = (isIframeData ? iframe.contentDocument : document).querySelector(selectorData);
        if (!dropdown) {
          console.log(`Dropdown with selector '${selectorData}' not found`);
          return false;
        }

        // @ts-ignore
        const desiredOption = Array.from(dropdown.options).find(({ text, value }) => text.includes(textValueData) || value.includes(textValueData));
        if (!desiredOption) {
          console.log(`Option containing '${textValueData}' not found`);
          return false;
        }

        console.log(`Option containing '${textValueData}' was found: ${isIframeData ? desiredOption.text : desiredOption.value}`);
        // @ts-ignore
        dropdown.value = desiredOption.value;
        const event = new Event('change', { bubbles: true });
        dropdown.dispatchEvent(event);

        return true;
      }, selector, textValue, isIframe, iFrameSelector);
    }

    async function setInputValue(selector, value, isIframe = false) {
      return context.evaluate(({ selectorData, valueData, isIframeData, iFrameSelectorData }) => {
        const getDocument = () => (isIframeData
          ? document.querySelector(iFrameSelectorData)?.contentDocument
          : document);

        const doc = getDocument();
        if (!doc) {
          console.log('iframe cannot be accessed in setInputValue function');
          return false;
        }

        const inputElement = doc.querySelector(selectorData);
        if (!inputElement) {
          console.log(`Input with selector '${selectorData}' not found`);
          return false;
        }

        inputElement.value = valueData;
        inputElement.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      }, { selectorData: selector, valueData: value, isIframeData: isIframe, iFrameSelector });
    }

    async function clickButton(xpath, isIframe = false) {
      return context.evaluate(({ xpathData, isIframeData, iFrameSelectorData }) => {
        // eslint-disable-next-line sonarjs/no-identical-functions
        const getDocument = () => (isIframeData
          ? document.querySelector(iFrameSelectorData)?.contentDocument
          : document);

        const doc = getDocument();
        if (!doc) {
          console.log('iframe cannot be accessed');
          return false;
        }

        const buttonElement = doc.evaluate(xpathData, doc, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
        if (!buttonElement) {
          console.log(`Button with XPath '${xpathData}' not found`);
          return false;
        }

        buttonElement.click();
        console.log('Button clicked.');
        return true;
      }, { xpathData: xpath, isIframeData: isIframe, iFrameSelector });
    }

    async function searchForDocument(type, number) {
      console.log(`Trying to set ${type} number:`, number);
      await setInputValue('input[id*="txtSingleNumber"]', number, true);
      await clickButton('//input[contains(@id,"btnGo")]', true);
      await new Promise(resolve => setTimeout(resolve, 15000));

      return context.evaluate((typeData, iFrameSelectorData) => {
        const iframe = document.querySelector(iFrameSelectorData);
        const doc = iframe?.contentDocument;
        if (!doc) {
          console.log('iframe cannot be accessed');
          return false;
        }

        const bodyElement = doc.querySelector('div[id="body"]');
        const tableElement = doc.querySelector('table[id*="dtgDocuments"]');
        let statusText;

        if (!bodyElement) {
          statusText = 'Unknown Failure';
        } else if (!tableElement) {
          statusText = `${typeData} Not Found`;
        } else {
          statusText = `${typeData} Found`;
        }

        if (!bodyElement || !tableElement) {
          const noDataContainer = document.createElement('div');
          noDataContainer.id = 'noData';
          document.body.appendChild(noDataContainer);
        }

        const statusContainer = document.createElement('div');
        statusContainer.id = 'srchStatus';
        statusContainer.textContent = statusText;
        document.body.appendChild(statusContainer);

        if (tableElement) document.body.appendChild(bodyElement);
        return true;
      }, type, iFrameSelector);
    }

    await processActions({
      inputs,
      actions: [
        { selectorOrXpath: 'input[id*="username"]', inputValue: '{siteUsr}', wait: 100 },
        { selectorOrXpath: 'input[id*="password"]', inputValue: '{sitePwd}', wait: 100 },
        { selectorOrXpath: 'input[value*="Sign in"]', wait: 10000 },
      ],
    });
    if (await helper.checkXpathSelector('//span[contains(@class,"error")]')) {
      await helper.addItemToDocument('noData', 'Invalid Login');
      await helper.addItemToDocument('srchStatus', 'Invalid Login');
    }

    await selectDropdownOption('select[id="selectedAccount"]', inputs.originalInputs.vnd1);
    await processActions({
      inputs,
      actions: [
        { selectorOrXpath: 'input[value*="Choose Account"]', wait: 10000 },
        { selectorOrXpath: '//a[contains(text(),"AP Inquiry")]', wait: 10000 },
      ],
    });

    if (inputs.originalInputs.poNo) {
      await selectDropdownOption('select[id*="drpCategory"]', 'Purchase Order', true);
      await selectDropdownOption('select[id*="DocType"]', 'Invoices only', true);
      await new Promise(resolve => setTimeout(resolve, 10000));
      await searchForDocument('PO', inputs.originalInputs.poNo);
    }

    if (inputs.originalInputs.invNo) {
      await searchForDocument('Invoice', inputs.originalInputs.invNo);
    }
  },
};
