module.exports = {
  implements: 'robots/san-antonio/beforeExtract',
  parameterValues: {
    country: 'US',
    domain: 'meijer',
    schemaYAML: 'multiPages',
  },
  implementation: async (inputs, parameters, context, dependencies) => {
    // date transform function. by Roman
    async function mmddyy(dateStr) {
      const year = dateStr.substring(0, 4);
      const month = dateStr.substring(4, 6);
      const day = dateStr.substring(6, 8);
      return `${month}/${day}/${year}`;
    }

    const submitBtnXpath = '//input[contains(@type,"submit")]';

    async function selectDropdownOption(selector, textValue) {
      return context.evaluate((selectorData, textValueData) => {
        const dropdown = document.querySelector(selectorData);
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

        console.log(`Option containing '${textValueData}' was found: ${desiredOption.value}`);
        // @ts-ignore
        dropdown.value = desiredOption.value;
        const event = new Event('change', { bubbles: true });
        dropdown.dispatchEvent(event);

        return true;
      }, selector, textValue);
    }

    const { helperModule: { Helpers }, goto2, processActions } = dependencies;
    const helper = new Helpers(context);
    if (await helper.checkXpathSelector('//div[contains(@id,"btn-log-in")]')) {
      await processActions({
        inputs,
        actions: [
          {
            selectorOrXpath: '//div[contains(@id,"btn-log-in")]',
            wait: 10000,
          },
        ],
      });
    }

    if (await helper.checkXpathSelector('//input[contains(@autocomplete,"username")]')) {
      await processActions({
        inputs,
        actions: [
          {
            selectorOrXpath: '//input[contains(@autocomplete,"username")]',
            inputValue: '{siteUsr}',
            wait: 100,
          },
          {
            selectorOrXpath: submitBtnXpath,
            wait: 10000,
          },
          {
            selectorOrXpath: '//input[contains(@type,"password")]',
            inputValue: '{sitePwd}',
            wait: 500,
          },
          {
            selectorOrXpath: submitBtnXpath,
            wait: 20000,
          },
        ],
      });
    }
    if (await helper.checkXpathSelector('//div[contains(@class,"infobox-error")]')) {
      await helper.addItemToDocument('NotFound', 'Invalid Login');
      await helper.addItemToDocument('srchStatus', 'Invalid Login');
    }
    if (await helper.checkXpathSelector('//span[contains(@class,"menu-item") and contains(text(),"Orders & Payments")]')) {
      console.log('Clicking on Orders & Payments');
      await processActions({
        inputs,
        actions: [
          {
            selectorOrXpath: '//span[contains(@class,"menu-item") and contains(text(),"Orders & Payments")]',
            wait: 1000,
          },
          {
            selectorOrXpath: '//li[contains(@aria-label,"Payments & Claims")]',
            wait: 10000,
          },
        ],
      });
      const firstDepthURL = await context.evaluate(() => {
        const xpath = '//a[contains(@href,"AccountsPayableVendorQuery")]/@href';
        const result = document.evaluate(xpath, document, null, XPathResult.STRING_TYPE, null);
        return result.stringValue;
      });
      console.log('first depth url is: ', firstDepthURL);
      await goto2({ ...inputs, url: firstDepthURL });
    }

    await new Promise(resolve => setTimeout(resolve, 5000));

    if (await helper.checkXpathSelector('//a[contains(@href,"VendorSelection")]/@href')) {
      const secondDepthURL = await context.evaluate(() => {
        const xpath = '//a[contains(@href,"VendorSelection")]/@href';
        const result = document.evaluate(xpath, document, null, XPathResult.STRING_TYPE, null);
        return result.stringValue;
      });
      console.log('first depth url is: ', secondDepthURL);
      await goto2({ ...inputs, url: secondDepthURL });
    }

    await new Promise(resolve => setTimeout(resolve, 5000));

    if (await helper.checkXpathSelector('//select[contains(@name,"cboVendorName")]')) {
      const textValue = inputs.originalInputs.vnd1;
      await context.evaluate((textValueData) => {
        const dropdown = document.querySelector('select[name="cboVendorName"]');
        // @ts-ignore
        const desiredValue = Array.from(dropdown.options).find(({ text }) => text.includes(textValueData));

        if (!desiredValue) {
          console.log(`Option containing '${textValueData}' not found`);
          return false;
        }
        console.log(`Option containing '${textValueData}' was found: ${desiredValue}`);
        // @ts-ignore
        dropdown.value = desiredValue.value;
        const event = new Event('change', { bubbles: true });
        dropdown.dispatchEvent(event);
        return true;
      }, textValue);
      await helper.optionalWait('//a[contains(@id,"lnkUnpaidStmt")]', '5000', 'XPATH');

      if (inputs.originalInputs?.invNo) {
        await processActions({
          inputs,
          actions: [
            {
              selectorOrXpath: '//input[contains(@name,"txtDocNo")]',
              inputValue: '{invNo}',
              wait: 100,
            },
            {
              selectorOrXpath: submitBtnXpath,
              wait: 2000,
            },
          ],
        });
        if (await helper.checkXpathSelector('//div[contains(@id,"dvNotFound")]')) {
          await processActions({
            inputs,
            actions: [
              {
                selectorOrXpath: '//a[contains(@id,"lnkQuerySelect")]',
                wait: 2000,
              },
              {
                selectorOrXpath: '//input[contains(@name,"txtPO")]',
                inputValue: '{poNo}',
                wait: 100,
              },
              {
                selectorOrXpath: submitBtnXpath,
                wait: 2000,
              },
            ],
          });
          if (await helper.checkXpathSelector('//div[contains(@id,"NotFound")]')) {
            await helper.addItemToDocument('srchStatus', 'Invoice Not Found');
          } else { await helper.addItemToDocument('srchStatus', 'PO Found'); }
        } else {
          await helper.addItemToDocument('srchStatus', 'Invoice Found');
        }
      } else if (inputs.originalInputs?.chkDte) {
        const dateArray = (await mmddyy(inputs.originalInputs.chkDte)).split('/');
        const date = (await mmddyy(inputs.originalInputs.chkDte));
        console.log('Checking by date', date);
        await selectDropdownOption('select[id="cboYear"]', dateArray[2]);
        await selectDropdownOption('select[id="cboMonth"]', dateArray[0]);
        await selectDropdownOption('select[id="cboDay"]', dateArray[1]);
        await processActions({
          inputs,
          actions: [
            {
              selectorOrXpath: submitBtnXpath,
              wait: 2000,
            },
            {
              selectorOrXpath: `//table[contains(@id,"grdResult")]//td/a[contains(text(),'${date.replace(/^0+/, '')}')]`,
              wait: 2000,
            },
          ],
        });
        if (await helper.checkXpathSelector('//div[contains(@id,"NotFound")]')) {
          await helper.addItemToDocument('srchStatus', 'Check Date Not Found');
        } else { await helper.addItemToDocument('srchStatus', 'Check Found'); }
      } else {
        await processActions({
          inputs,
          actions: [
            {
              selectorOrXpath: '//a[contains(@id,"lnkUnpaidStmt")]',
              wait: 100,
            },
            {
              selectorOrXpath: '//input[contains(@id,"btnSearch")]',
              wait: 2000,
            },
          ],
        });
        if (await helper.checkXpathSelector('//div[contains(@id,"spnNotFound")]')) {
          await helper.addItemToDocument('srchStatus', 'Unpaid Statement  Not Found');
        } else { await helper.addItemToDocument('srchStatus', 'Trial Balance Found'); }
      }
    }
  },
};
