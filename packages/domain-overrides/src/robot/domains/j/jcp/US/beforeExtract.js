module.exports = {
  implements: 'robots/san-antonio/beforeExtract',
  parameterValues: {
    country: 'US',
    domain: 'jcp',
    schemaYAML: 'multiPages',
  },
  implementation: async (inputs, parameters, context, dependencies) => {
    const { helperModule: { Helpers }, processActions } = dependencies;
    const helper = new Helpers(context);

    if (await helper.checkXpathSelector('//input[@id="usernameField"][not(@readonly)]')) {
      console.log('ORDERED ACTIONS FROM BEFORE EXTRACT');
      await processActions({
        inputs,
        actions: [
          {
            selectorOrXpath: '//input[@id="usernameField"][not(@readonly)]',
            inputValue: '{siteUsr}',
          },
          {
            selectorOrXpath: '//input[@id="passwordField"]',
            inputValue: '{sitePwd}',
          },
          {
            selectorOrXpath: '//button[@onclick="submitCredentials()"]',
            wait: 5000,
          },
        ],
      });
      // check for login failed or new password.
      if (await helper.checkXpathSelector('//*[contains(text(),"Login failed. Please retry your login")] | //label[contains(text(), "Re-enter New Password")]')) {
        await context.halt(true);
      }

      await processActions({
        inputs,
        actions: [
          {
            selectorOrXpath: '//a[@title="Payables"][not(ancestor::html//*[@id="ResultRN"])]',
            wait: 5000,
          },
          {
            selectorOrXpath: '//input[@id="SupplierPaymentSite"][not(ancestor::html//*[@id="ResultRN"])]',
            inputValue: 'FACTOR',
          },
          {
            selectorOrXpath: '//button[@id="Submit"][not(ancestor::html//*[@id="ResultRN"])]',
            wait: 10000,
          },
          {
            selectorOrXpath: '//a[@id="POS_INVOICES"][not(ancestor::html//*[@id="ResultRN"])]',
            wait: 10000,
          },
          {
            selectorOrXpath: '//input[@id="SearchInvoiceNum"]',
            inputValue: '{invNo}',
          },
        ],
      });
    }
    // choosing not paid if there is no invNo in input.
    if (!inputs.originalInputs.invNo) {
      const selector = 'select#SearchPaymentStatus';
      const textValue = 'Not Paid';
      await helper.dropDownValue(selector, textValue);
    }
    if (await helper.checkXpathSelector('//button[@title="Go"][ancestor::html//table//*[contains(text(), "No search conducted")]]')) {
      await processActions({
        inputs,
        actions: [
          {
            selectorOrXpath: '//button[@title="Go"][ancestor::html//table//*[contains(text(), "No search conducted")]]',
            wait: 30000,
          },
        ],
      });
      if (await helper.checkXpathSelector('//*[contains(text(), "No results found")]')) {
        // eslint-disable-next-line no-useless-escape
        const data = '"\"invNo\"\t\"invDte\"\t\"adjReas\"\t\"grossAmt\"\t\"reasCode\"\t\"invStatus\"\t\"dueDte\"\t\"chkNo\"\t\"poNo\"\t\"Receipt\"\t\"Discount Date\"\t\"Available Discount\"\t\n\"\"\t\"\"\t\"\"\t\"\"\t\"\"\t\"\"\t\"\"\t\"\"\t\"\"\t\"\"\t\"\"\t\"\"\t\"\"\t\"\"\t\"\"\t\"\"\t\"\"\t';

        await context.setData([
          {
            extractionConfig: 'domains/j/jcp/US/extract.js',
            // @ts-ignore
            // eslint-disable-next-line no-undef
            data: await extractorContext.createData(data),
          },
        ]);
        await context.halt(false);
      }
      await processActions({
        inputs,
        actions: [
          {
            selectorOrXpath: '//button[@id="ExportBtn"]',
            wait: 30000,
          },
        ],
      });
    }

    console.log('>>>>>>>>>>>>>>>>>>>>>>>>Export file button is clicked. Waiting 50 seconds for request finish.');
    await new Promise(resolve => setTimeout(resolve, 50000));
    console.log('>>>>>>>>>>>>>>>>>>>>>>>> 50 seconds passed. Searching for requests.');

    const handleRequests = async ({ method, keyword }) => {
      const searchRequests = await context?.searchAllRequests(keyword, method);
      console.log(searchRequests);
      console.log('Requests', method, searchRequests.length);
      // const requests = await getResponse(searchRequests);
      const requests = searchRequests || [];
      await Promise.all(requests.map(async (request) => {
        await context?.evaluate((req) => {
          const div = document.createElement('div');
          div.setAttribute('class', `${req?.method.toLowerCase()}Requests`);
          div.setAttribute('url', req?.url);
          div.innerText = JSON.stringify(req);
          document.body.appendChild(div);
        }, request);
      }));
      return requests;
    };

    const [firstPost] = await handleRequests({ method: 'POST', keyword: '/OA_HTML/OA' });

    async function replayFetch(request) {
      const { method } = request;
      const { body } = request.responseBody;
      const host = 'https://bizpartner.jcp.com';
      const regex = /\/OA_HTML\/OA.jsp\?page=\/oracle\/apps\/pos\/account\/webui\/PosInvoiceMainPG&_ri=177&searchType.*?\.\./;
      const match = body.match(regex);
      const url = `${host}${match[0]}`;
      const requestHeaders = {
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
        'accept-language': 'en-US,en;q=0.9',
        'cache-control': 'max-age=0',
        'content-type': 'application/x-www-form-urlencoded',
        'sec-ch-ua': '"Chromium";v="127", "Not)A;Brand";v="99"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Linux"',
        'sec-fetch-dest': 'document',
        'sec-fetch-mode': 'navigate',
        'sec-fetch-site': 'same-origin',
        'upgrade-insecure-requests': '1',
        'sec-fetch-user': '?1',
      };
      const referrer = request.requestHeaders.referer;
      const regex1id = /_AM_TX_ID_FIELD.*?value=\s*"([A-Za-z0-9\S]+)"/;
      const amtxidField = body.match(regex1id)[1];
      // eslint-disable-next-line no-useless-escape
      const invNoRegex = /name=\"SearchInvoiceNum.*?value=\s*"([A-Za-z0-9\S]+)"><img src/;
      const invNoMatch = body.match(invNoRegex);
      const invNo = invNoMatch && invNoMatch[1] ? invNoMatch[1] : '';
      const viewPortHeight = invNoMatch ? '' : 'viewPortHeight%3AResultRN=1175px&';
      const lengthNum = invNoMatch ? '1' : '75';
      // eslint-disable-next-line no-useless-escape
      const regexFORM = /value=\"(DefaultFormName[A-Za-z0-9\S]+)\"\sname=\"_FORM/;
      const form = body.match(regexFORM)[1];
      // eslint-disable-next-line no-useless-escape
      const spsregex = /name=\"SearchPaymentStatus.*?selected value=\"([A-Za-z0-9\S]+)"\>/;
      const spsMatch = body.match(spsregex);
      const sps = spsMatch && spsMatch[1] ? spsMatch[1] : '';
      // eslint-disable-next-line no-useless-escape
      const pageNameregex = /_fwkAbsolutePageName.*?value=\"([A-Za-z0-9\S]+)\" name=\"_fwkAbsolutePageName/;
      const pageName = body.match(pageNameregex)[1];
      // eslint-disable-next-line no-useless-escape
      const customizeSubmitregex = /customizeSubmitButton\$\$processFormDataCalled.*?value=\"([A-Za-z0-9\S]+)\"\sname=\"customizeSubmit/;
      const customizeSubmit = body.match(customizeSubmitregex)[1];
      // eslint-disable-next-line no-useless-escape
      const clearButtonregex = /clearButton\$\$unvalidated.*?value=\"([A-Za-z0-9\S]+)\"\sname=\"clearButton/;
      const clearButton = body.match(clearButtonregex)[1];
      // eslint-disable-next-line no-useless-escape
      const processFormDataCalledregex = /clearButton\$\$processFormDataCalled.*?value=\"([A-Za-z0-9\S]+)\"\sname=\"clearButton/;
      const processFormDataCalled = body.match(processFormDataCalledregex)[1];
      // eslint-disable-next-line no-useless-escape
      const cnfMsgregex = /cnfMsg.*?value=\"([A-Za-z0-9\S]+)\"\sname=\"cnfMsg/;
      const cnfMsg = body.match(cnfMsgregex)[1];
      // eslint-disable-next-line no-useless-escape
      const fwkActBtnNameregex = /_fwkActBtnName.*?value=\"([A-Za-z0-9\S]+)\"\sname=\"_fwkActBtnName/;
      const fwkActBtnName = body.match(fwkActBtnNameregex)[1];

      const regexNumber = /tablerefresh','([A-Za-z0-9\S]+)',/;
      const number = body.match(regexNumber)[1];

      const regexNumbUnvalidated = new RegExp(`${number}\\$\\$unvalidated.*?value="([A-Za-z0-9\\S]+)"\\sname="${number}\\$\\$unvalidated`);
      const Numbunvalidated = body.match(regexNumbUnvalidated)[1];
      const regexNumbServerUnvalidated = new RegExp(`${number}\\$\\$serverUnvalidated.*?value="([A-Za-z0-9\\S]+)"\\sname="${number}\\$\\$serverUnvalidated`);
      const NumbserverUnvalidated = body.match(regexNumbServerUnvalidated)[1];
      // eslint-disable-next-line no-useless-escape
      const regexAdvSearch = /advancedSearchButton\$\$unvalidated.*?value=\"([A-Za-z0-9\S]+)\"\sname=\"advancedSearchButton\$\$unvalidated/;
      const AdvSearch = body.match(regexAdvSearch)[1];
      // eslint-disable-next-line no-useless-escape
      const regexAdvSearchServer = /advancedSearchButton\$\$serverUnvalidated.*?value=\"([A-Za-z0-9\S]+)\"\sname=\"advancedSearchButton\$\$serverUnvalidated/;
      const AdvSearchServer = body.match(regexAdvSearchServer)[1];
      // eslint-disable-next-line no-useless-escape
      const regexFormDataCalled = /advancedSearchButton\$\$processFormDataCalled.*?value=\"([A-Za-z0-9\S]+)\"\sname=\"advancedSearchButton\$\$processFormDataCalled/;
      const FormDataCalled = body.match(regexFormDataCalled)[1];
      // eslint-disable-next-line no-useless-escape
      const regexOpenPopup = /openPopupSourceId.*?value=\"([A-Za-z0-9\S]+)\"\sname=\"openPopupSourceId/;
      const OpenPopup = body.match(regexOpenPopup)[1];
      // eslint-disable-next-line no-useless-escape
      const regexExportBtnUnv = /ExportBtn\$\$unvalidated.*?value=\"([A-Za-z0-9\S]+)\"\sname=\"ExportBtn\$\$unvalidated/;
      const ExportBtnUnv = body.match(regexExportBtnUnv)[1];
      // eslint-disable-next-line no-useless-escape
      const regexExpBtnserver = /ExportBtn\$\$serverUnvalidated.*?value=\"([A-Za-z0-9\S]+)\"\sname=\"ExportBtn\$\$serverUnvalidated/;
      const ExpBtnserver = body.match(regexExpBtnserver)[1];
      // eslint-disable-next-line no-useless-escape
      const regexExpBtnproc = /ExportBtn\$\$processFormDataCalled.*?value=\"([A-Za-z0-9\S]+)\"\sname=\"ExportBtn\$\$processFormDataCalled/;
      const ExpBtnproc = body.match(regexExpBtnproc)[1];
      // eslint-disable-next-line no-useless-escape
      const regexFormMacList = /FORM_MAC_LIST.*?value=\"([A-Za-z0-9\S]+)\"\sname=\"FORM_MAC_LIST/;
      const FormMacList = body.match(regexFormMacList)[1];
      // eslint-disable-next-line no-useless-escape
      const regexserverValidate = /serverValidate\\':\\'([A-Za-z0-9\S]+)\\\',event/;
      const serverValidate = body.match(regexserverValidate)[1];
      const regexFormSubmitButton = /_FORM_SUBMIT_BUTTON\\':\\'([A-Za-z0-9\S]+)\\',\\'server/;
      const FormSubmitButton = body.match(regexFormSubmitButton)[1];
      const requestBody = `_AM_TX_ID_FIELD=${amtxidField}&_FORM=${form}&SearchInvoiceNum=${invNo}&SearchPoNumber=&SearchRelNumber=&SearchPaymentNumber=&SearchInvoiceStatus=&SearchPaymentStatus=${sps}&SearchInvoiceAmountFrom=&SearchInvoiceAmountTo=&SearchDueAmountFrom=&SearchDueAmountTo=&SearchInvoiceDateFrom=&SearchInvoiceDateTo=&SearchDueDateFrom=&SearchDueDateTo=&${viewPortHeight}direction%3A${number}=&${number}%3Alength=${lengthNum}&InvSimpleSupplierId=&InvAdvSupplierId=&_fwkAbsolutePageName=${pageName}&customizeSubmitButton%24%24processFormDataCalled=${customizeSubmit}&clearButton%24%24unvalidated=${clearButton}&clearButton%24%24processFormDataCalled=${processFormDataCalled}&cnfMsg=${cnfMsg}&_fwkActBtnName_RepEnabled_runNettingReport%24%24serverUnvalidated=${fwkActBtnName}&${number}%24%24unvalidated=${Numbunvalidated}&${number}%24%24serverUnvalidated=${NumbserverUnvalidated}&advancedSearchButton%24%24unvalidated=${AdvSearch}&advancedSearchButton%24%24serverUnvalidated=${AdvSearchServer}&advancedSearchButton%24%24processFormDataCalled=${FormDataCalled}&openPopupSourceId=${OpenPopup}&ExportBtn%24%24unvalidated=${ExportBtnUnv}&ExportBtn%24%24serverUnvalidated=${ExpBtnserver}&ExportBtn%24%24processFormDataCalled=${ExpBtnproc}&FORM_MAC_LIST=${FormMacList}&_FORMEVENT=&serverValidate=${serverValidate}&evtSrcRowIdx=&evtSrcRowId=&_FORM_SUBMIT_BUTTON=${FormSubmitButton}&event=EXPORT_BUTTON_SELECTED&source=ExportBtn&value=&size=&partialTargets=&partial=&state=&attachStyleParam=`;
      try {
        const fetchResponse = await fetch(url, {
          headers: requestHeaders,
          referrer,
          body: requestBody,
          method,
        });
        console.log('Fetch response:', fetchResponse);
      } catch (error) {
        console.error('Fetch error:', error);
      }
    }

    console.log(`>>>>>>>>>>>>>>>>>>>>>>>> Replaying firstPost - ${firstPost}.`);
    await context.evaluate(replayFetch, firstPost);
    console.log('>>>>>>>>>>>>>>>>>>>>>>>> Waiting 50 seconds for replay finish.');
    await new Promise(resolve => setTimeout(resolve, 50000));
    console.log('>>>>>>>>>>>>>>>>>>>>>>>> Replaying finished.');

    // return request
    const extractRequests = async ({ method, keyword }) => {
      const searchRequests = await context?.searchAllRequests(keyword, method);
      console.log(searchRequests);
      console.log('Requests', method, searchRequests.length);
      return searchRequests[1].responseBody.body;
    };
    const tsvData = await extractRequests({ method: 'GET', keyword: 'OA_HTML/OAExport' });

    const monthMap = {
      jan: '01',
      feb: '02',
      mar: '03',
      apr: '04',
      may: '05',
      jun: '06',
      jul: '07',
      aug: '08',
      sep: '09',
      oct: '10',
      nov: '11',
      dec: '12',
    };

    const transformDate = (text) => {
      const [day, month, year] = text.split('-');
      const monthNumber = monthMap[month.toLowerCase()];
      return `${year}${monthNumber}${day.padStart(2, '0')}`;
    };

    const rows = tsvData.trim().split('\n');

    const headers = rows[0].split('\t').map((header) => {
      const cleanedHeader = header.replace(/"/g, '');
      if (cleanedHeader === 'Invoice') return 'invNo';
      if (cleanedHeader === 'Invoice Date') return 'invDte';
      if (cleanedHeader === 'Type') return 'adjReas';
      if (cleanedHeader === 'Amount') return 'grossAmt';
      if (cleanedHeader === 'Status') return 'reasCode';
      if (cleanedHeader === 'Payment Status') return 'invStatus';
      if (cleanedHeader === 'Due Date') return 'dueDte';
      if (cleanedHeader === 'Payment') return 'chkNo';
      if (cleanedHeader === 'PO Number') return 'poNo';
      return cleanedHeader;
    });
    const dataRows = rows.slice(1);

    const data = dataRows.map((row) => {
      const values = row.split('\t').map(value => value.replace(/"/g, ''));
      return headers.reduce((acc, header, index) => {
        const newObj = { ...acc }; // Create a shallow copy of the accumulator object
        if (!header) {
          return newObj;
        }
        // Apply the date transformation for 'invDte' and 'Due Date' fields
        if (header === 'invDte' || header === 'dueDte') {
          newObj[header] = values[index] ? transformDate(values[index]) : '';
        } else {
          newObj[header] = values[index] || '';
        }
        return newObj;
      }, {});
    });

    await context.setData([
      {
        extractionConfig: 'domains/j/jcp/US/extract.js',
        // @ts-ignore
        // eslint-disable-next-line no-undef
        data: await extractorContext.createData(data),
      },
    ]);

    await context.halt(false);
  },
};

/**
 *   // CITScrolling
  async CITScrolling(scrollContainerId, loadingSelector) {
    await this.context.evaluate(async (scrollContainerId, loadingSelector) => {
      try {
        // Scroll to a specific footer button to ensure visibility
        const footerButton = document.getElementById('ExportBtn_uixr');
        if (footerButton) {
          console.log('>>> FOOTER FOUND <<<');
          footerButton.scrollIntoView({ behavior: 'smooth' });
        } else {
          console.log('Footer button not found');
        }

        // Select the scrollable container using its ID
        const container = document.getElementById(scrollContainerId);
        if (container) {
          console.log('>>> SCROLLABLE CONTAINER IS HERE <<<');
        } else {
          console.log('>>> SCROLLABLE CONTAINER NOT FOUND <<<');
          return;
        }

        // Function to scroll down the container
        const scrollDown = async () => {
          console.log('Scrolling down...');
          container.scrollBy(0, container.clientHeight);
          return new Promise(resolve => setTimeout(resolve, 3000)); // Wait for 3 seconds
        };

        // Function to check if the loading indicator is present
        const isLoading = () => {
          const loadingElement = document.querySelector(loadingSelector);
          console.log('Loading indicator present:', loadingElement !== null);
          return loadingElement !== null;
        };

        let lastHeight = container.scrollHeight;
        let newHeight = lastHeight;

        // Loop until the end of the container is reached
        while (true) {
          await scrollDown();
          newHeight = container.scrollHeight;
          console.log('New height:', newHeight, 'Last height:', lastHeight);

          if (newHeight === lastHeight) {
            // No change in height and no loading indicator, end of content reached
            break;
          }
          lastHeight = newHeight;
        }

        console.log('Reached the bottom of the table.');
      } catch (error) {
        console.log('An error occurred while scrolling:', error);
      }
    }, scrollContainerId, loadingSelector);
  }

 */
