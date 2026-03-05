module.exports = {
  implements: 'robots/san-antonio/beforeExtract',
  parameterValues: {
    country: 'US',
    domain: 'tjx',
    schemaYAML: 'singlePage',
  },
  // eslint-disable-next-line sonarjs/cognitive-complexity, consistent-return
  implementation: async (inputs, parameters, context, dependencies) => {
    const { helperModule: { Helpers }, goto2, processActions } = dependencies;
    const helper = new Helpers(context);

    // date transform function.
    async function mmddyy(dateStr) {
      const year = dateStr.substring(0, 4);
      const month = dateStr.substring(4, 6);
      const day = dateStr.substring(6, 8);
      const shortYear = year.substring(2);
      return `${month}/${day}/${shortYear}`;
    }

    async function checkForPaymentDate(date) {
      let pageDir = 1; // Start with the initial page
      const dateXPath = `//span[(contains(@id,"_ctl14_L") or contains(@id,"_ctl14_l")) and contains(text(),"${date}")]`;

      while (true) { // Infinite loop, will exit only when date is found
        try {
          // Check if the date is present on the current page
          const dateIsOnPage = await helper.checkXpathSelector(dateXPath);

          if (dateIsOnPage) {
            console.log(`Payment date "${date}" found on page with pagedir=${pageDir}.`);
            return true; // Exit the function if date is found
          }

          // Log progress and move to the next page
          console.log(`Payment date "${date}" not found on pagedir=${pageDir}. Moving to next page...`);
          // eslint-disable-next-line no-plusplus
          pageDir++; // Increment the page directory

          // eslint-disable-next-line no-await-in-loop
          await goto2({ ...inputs, url: `https://www.tjxvendors.com/invoices.aspx?pagedir=${pageDir}&vendor=-1` });

          // Optional wait in case of CAPTCHA or dynamic loading
          // eslint-disable-next-line no-await-in-loop
          await helper.optionalWait(dateXPath, 3000);
        } catch (error) {
          console.error(`Error encountered on pagedir=${pageDir}:`, error);

          // Retry on the same page if the error is recoverable
          // Optionally, you can add a delay before retrying
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      }
    }

    if (inputs.originalInputs?.vnd2 && inputs.originalInputs?.vnd2?.length) {
      console.log('>>>>>>  SEQUENCE 1. VENDOR FOUND IN INPUT.  <<<<<<');
      if (await helper.checkXpathSelector('//center//a')) {
        await goto2({ ...inputs, url: 'https://www.tjxvendors.com/login.aspx?ReturnUrl=%2flogin' });
        await new Promise(resolve => setTimeout(resolve, 10000));
      }
      if (await helper.checkXpathSelector('//table//input[@id="username"]')) {
        await processActions({
          inputs,
          actions: [
            {
              selectorOrXpath: '//input[@id="username"]',
              inputValue: '{siteUsr}',
            },
            {
              selectorOrXpath: '//input[@id="password"]',
              inputValue: '{sitePwd}',
            },
            {
              selectorOrXpath: '//input[@id="ibLogin"]',
              wait: 10000,
              captchaCheck: true,
            },
            {
              selectorOrXpath: '//input[@id="ibInvoices"]',
              wait: 10000,
              captchaCheck: true,
            },
          ],
        });
      }

      await helper.CITBlocked('//a[contains(text(),"[Go Back]")]');

      if (await helper.checkXpathSelector('//select[@name="ddlbVendors"]/option[@selected="selected"][contains(text(), "-ALL")]')) {
        const selector = 'select[name="ddlbVendors"]';
        const textValue = inputs.originalInputs.vnd2;
        await helper.dropDownValue(selector, textValue, 5000);

        if (await helper.checkXpathSelector('//select[@name="ddlbVendors"]/option[@selected="selected"][contains(text(), "-ALL")]')) {
          console.log(`>>>>>>VENDOR "${inputs.originalInputs.vnd2}" IS NOT IN THE DROPDOWN<<<<<<`);
          await context.halt(true);
        }
      }
    } else {
      console.log('SEQUENCE 2 IS IN PROGRESS');
      await processActions({
        inputs,
        actions: [
          {
            selectorOrXpath: '//input[@id="username"]',
            inputValue: '{siteUsr}',
          },
          {
            selectorOrXpath: '//input[@id="password"]',
            inputValue: '{sitePwd}',
          },
          {
            selectorOrXpath: '//input[@id="ibLogin"]',
            wait: 10000,
            captchaCheck: true,
          },
          {
            selectorOrXpath: '//input[@id="cbUnpaid"]',
            wait: 1000,
          },
          {
            selectorOrXpath: '//input[@id="ibInvoices"]',
            wait: 10000,
            captchaCheck: true,
          },
        ],
      });
      const sortingXpath = '//img[contains(@src,"images/descending.gif") and contains(@id,"titles_ctl14_imgSort")]';
      const sortingUrl = 'https://www.tjxvendors.com/invoices.aspx?col=14&vendor=-1';
      if (!await helper.checkXpathSelector(sortingXpath)) {
        await goto2({ ...inputs, url: sortingUrl });
      }
      await new Promise(resolve => setTimeout(resolve, 2000));
      console.log('Wait for 3 seconds passed');
      if (!await helper.checkXpathSelector(sortingXpath)) {
        await processActions({
          inputs,
          actions: [
            {
              selectorOrXpath: '//a[contains(@id,"titles_ctl14_colHdr")]',
              wait: 10000,
              captchaCheck: true,
            },
          ],
        });
      }

      // Checking for payment date on the page.
      const paymentDate = await mmddyy(inputs.originalInputs.chkDte);
      // Calling the recursive function until date is found.
      if (await checkForPaymentDate(paymentDate)) {
        const extractedText = await context.evaluate((paymentDateValue) => {
          // Grabbing the payment number in the next column for goto2().
          const xpath = `//span[(contains(@id,"_ctl14_L") or contains(@id,"_ctl14_l")) and contains(text(),"${paymentDateValue}")]//parent::td//following-sibling::td/a/text()`;
          const result = document.evaluate(xpath, document, null, XPathResult.STRING_TYPE, null);
          return result.stringValue;
        }, paymentDate);

        await goto2({ ...inputs, url: `https://www.tjxvendors.com/check.aspx?check=${extractedText}` });
      } else {
        console.log('Date not found');
        await context.halt(true);
      }

      const DATA = await context.evaluate(() => {
        const formatDate = (text) => {
          const [month, day, year] = text.split('/');
          return `20${year}${month.padStart(2, '0')}${day.padStart(2, '0')}`;
        };

        // @ts-ignore
        const headers = [...document.querySelectorAll('tr:nth-of-type(3) span.footerbold')].map(el => el.textContent.trim());
        const headerMapping = {
          'Invoice Number': 'invNo',
          'Invoice Date': 'invDte',
          'P.O. Number': 'poNo',
          'Invoice Amount': 'grossAmt',
          'Discount Amount': 'discAmt',
          'Amount Paid': 'netAmt',
        };

        const mappedHeaders = headers.map(header => headerMapping[header]);
        const getVal = (currentRow, selector) => {
          let row = currentRow;
          while (row) {
            const vendorElement = row.previousElementSibling?.querySelector(selector);
            if (vendorElement) return vendorElement.textContent.trim();
            row = row.previousElementSibling; // Move to the previous row
          }
          return null;
        };
        // @ts-ignore
        return [...document.querySelectorAll('.even_row, .odd_row')].map(el => Object.assign({
          chkDte: formatDate(document.querySelector('#lblChkDateVal').textContent),
          chkNo: document.querySelector('#lblCheckVal').textContent,
          strNo: getVal(el, '[id*="_lblProcessSet"]'),
          vndId: getVal(el, '[id*="_lblVendor"]')?.match(/\d+/)?.[0],
          vndName: getVal(el, '[id*="_lblVendor"]')?.match(/\d+\W+(.+$)/)?.[1],
          chkAmt: document.querySelector('#lblTotPdAmt').textContent.replace(/,/g, ''),
        }, ...[...el.querySelectorAll('td')].map((elem, index) => ({ [mappedHeaders[index]]: index === 1 ? formatDate(elem.textContent.trim()) : elem.textContent.trim().replace(/,/g, '') }))));
      });

      await context.setData([
        {
          extractionConfig: 'domains/t/tjx/US/extract.js',
          // @ts-ignore
          // eslint-disable-next-line no-undef
          data: await extractorContext.createData(DATA),
        },
      ]);
      await context.halt(false);
    }
  },
};
