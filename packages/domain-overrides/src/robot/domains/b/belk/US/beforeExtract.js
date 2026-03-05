module.exports = {
  implements: 'robots/san-antonio/beforeExtract',
  parameterValues: {
    country: 'US',
    domain: 'belk',
    schemaYAML: 'navSeq3',
  },
  implementation: async (inputs, parameters, context, dependencies) => {
    // eslint-disable-next-line no-unused-vars
    const { helperModule: { Helpers }, goto2, processActions } = dependencies;
    const helper = new Helpers(context);
    if (inputs.originalInputs?.type.includes('Recent Payment Information')) {
      console.log('>>>>>>   SEQUENCE 3. Recent Payment Information   <<<<<<');
      await processActions({
        inputs,
        actions: [
          {
            selectorOrXpath: '//*[contains(@href,"recentPaymentInfo")]',
            wait: 3000,
          },
        ],
      });
      if (await helper.checkXpathSelector('//h2[contains(text(),"Recent Payment Information")]')) {
        const checkDateInput = inputs.originalInputs?.chkDte;
        const checkDate = checkDateInput.replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3');
        if (await helper.checkXpathSelector(`//*[contains(text(),"${checkDate}")]`)) {
          const extractedText = await context.evaluate((checkDateValue) => {
            const xpath = `//td[contains(text(),"${checkDateValue}")]/preceding-sibling::td`;
            const result = document.evaluate(xpath, document, null, XPathResult.STRING_TYPE, null);
            return result.stringValue;
          }, checkDate);

          await goto2({ ...inputs, url: `https://vendorportal.belk.com/VendorPortal/checkRemittanceDesc.do?method=Submit&checkNbr=${extractedText}` });
        } else {
          console.log(`Date ${checkDate} not found`);
        }

        const vndName = await context.evaluate(() => {
          const vndNamexpath = '//td[contains(text(),"Account Number")]/preceding-sibling::td[1]';
          return document.evaluate(vndNamexpath, document, null, XPathResult.STRING_TYPE, null).stringValue;
        });
        const vndID = await context.evaluate(() => {
          const vndIDxpath = '//td[contains(text(),"Payment Amount")]/preceding-sibling::td[1]';
          return document.evaluate(vndIDxpath, document, null, XPathResult.STRING_TYPE, null).stringValue;
        });
        const chkNo = await context.evaluate(() => {
          const chkNoxpath = '//td[contains(text(),"Payment Date")]/preceding-sibling::td[1]';
          return document.evaluate(chkNoxpath, document, null, XPathResult.STRING_TYPE, null).stringValue;
        });
        const chkDte = await context.evaluate(() => {
          const chkDtexpath = '//td[contains(text(),"Payment Amount")]/following-sibling::td/following-sibling::td';
          return document.evaluate(chkDtexpath, document, null, XPathResult.STRING_TYPE, null).stringValue;
        });
        const chkAmt = await context.evaluate(() => {
          const chkAmtxpath = '//td[contains(text(),"Payment Date")]/following-sibling::td/following-sibling::td';
          return document.evaluate(chkAmtxpath, document, null, XPathResult.STRING_TYPE, null).stringValue;
        });
        const srchStatus = await context.evaluate(() => {
          const tableSelector = document.querySelector('form[name="checkRemittance"] div table tbody tr');
          if (tableSelector) {
            const div = document.createElement('div');
            div.setAttribute('id', 'srchStatus');
            div.innerText = 'Check Found';
            document.body.appendChild(div);
          }
          const srchStatusxpath = '//div[@id="srchStatus"]';
          return document.evaluate(srchStatusxpath, document, null, XPathResult.STRING_TYPE, null).stringValue;
        });
        await context.evaluate((vndName1, vndID1, chkNo1, chkDte1, chkAmt1, srchStatus1) => {
          // eslint-disable-next-line sonarjs/no-duplicate-string
          const headers = document.querySelectorAll('tr th[class="grid1_header"]');
          const headerMap = Array.from(headers).reduce((map, header, index) => {
            const headerText = header.textContent.trim().replace(/\n+/g, '');
            if (headerText) {
              // eslint-disable-next-line no-param-reassign
              map[index + 1] = headerText;
            }
            return map;
          }, {});
          const rows = document.querySelectorAll('form[name="checkRemittance"] div table tbody tr');
          rows.forEach((row) => {
            const cells = row.querySelectorAll('td');
            cells.forEach((cell, index) => {
              const headerText = headerMap[index + 1];
              if (headerText) {
                cell.setAttribute('column', headerText);
              }
            });
          });
          // eslint-disable-next-line sonarjs/no-duplicate-string
          const headerElement = document.querySelector('tr th[class="grid1_header"]');
          const { parentElement } = headerElement;
          const thData = ['vndName', 'vndID', 'chkNo', 'chkDte', 'chkAmt', 'srchStatus'];
          thData.forEach((text) => {
            const th = document.createElement('th');
            th.setAttribute('class', 'grid1_header');
            th.textContent = text;
            parentElement.appendChild(th);
          });
          const rowElements = Array.from(document.querySelectorAll('form[name="checkRemittance"] div tbody tr'));
          const tdData = [vndName1, vndID1, chkNo1, chkDte1, chkAmt1, srchStatus1];
          rowElements.forEach((rowElement) => {
            tdData.forEach((text) => {
              const td = document.createElement('td');
              td.textContent = text;
              rowElement.appendChild(td);
            });
          });
        }, vndName, vndID, chkNo, chkDte, chkAmt, srchStatus);

        // const DATA = await context.evaluate(() => {
        //   const formatDate = (text) => text.replace(/-/g, '');

        //   // @ts-ignore
        //   const headers = [...document.querySelectorAll('[class="grid1_header"]')].map(el => el.textContent.trim());

        //   const headerMapping = {
        //     'STR #': 'strNo',
        //     'INVC #': 'invNo',
        //     'Invoice Date': 'invDte',
        //     'PO #': 'poNo',
        //     'GROSS COST': 'grossAmt',
        //     'Discount Amount': 'discAmt',
        //     'Amount Paid': 'netAmt',

        //     'STR #', 'INVC #', 'PO #', 'GROSS COST', 'FRT INVC', 'FRT DED', 'RC', 'DISC AMT', 'RC', 'ADJ AMT', 'RC', 'NET AMT'
        //   };

        //   const mappedHeaders = headers.map(header => headerMapping[header]);
        //   const getVal = (currentRow, selector) => {
        //     let row = currentRow;
        //     while (row) {
        //       const vendorElement = row.previousElementSibling?.querySelector(selector);
        //       if (vendorElement) return vendorElement.textContent.trim();
        //       row = row.previousElementSibling; // Move to the previous row
        //     }
        //     return null;
        //   };
        //   // @ts-ignore
        //   return [...document.querySelectorAll('.even_row, .odd_row')].map(el => Object.assign({
        //     chkDte: formatDate(document.querySelector('#lblChkDateVal').textContent),
        //     chkNo: document.querySelector('#lblCheckVal').textContent,
        //     strNo: getVal(el, '[id*="_lblProcessSet"]'),
        //     vndId: getVal(el, '[id*="_lblVendor"]')?.match(/\d+/)?.[0],
        //     vndName: getVal(el, '[id*="_lblVendor"]')?.match(/\d+\W+(.+$)/)?.[1],
        //     chkAmt: document.querySelector('#lblTotPdAmt').textContent.replace(/,/g, ''),
        //   }, ...[...el.querySelectorAll('td')].map((elem, index) => ({ [mappedHeaders[index]]: index === 1 ? formatDate(elem.textContent.trim()) : elem.textContent.trim().replace(/,/g, '') }))));
        // });

        // await context.setData([
        //   {
        //     extractionConfig: 'domains/b/belk/US/extract.js',
        //     // @ts-ignore
        //     // eslint-disable-next-line no-undef
        //     data: await extractorContext.createData(DATA),
        //   },
        // ]);
        // await context.halt(false);
      }
      // await context.evaluate(() => {
      //   const headers = document.querySelectorAll('tr th[class="grid1_header"]');
      //   const headerMap = Array.from(headers).reduce((map, header, index) => {
      //     const headerText = header.textContent.trim().replace(/\n+/g, '');
      //     if (headerText) {
      //       // eslint-disable-next-line no-param-reassign
      //       map[index + 1] = headerText;
      //     }
      //     return map;
      //   }, {});
      //   const rows = document.querySelectorAll('form[name="checkRemittance"] div table tbody tr');
      //   rows.forEach((row) => {
      //     const cells = row.querySelectorAll('td');
      //     cells.forEach((cell, index) => {
      //       const headerText = headerMap[index + 1];
      //       if (headerText) {
      //         cell.setAttribute('column', headerText);
      //         const div = document.createElement('div');
      //         div.setAttribute('id', 'srchStatus');
      //         div.setAttribute('text', 'Check Found');
      //         document.body.appendChild(div);
      //       }
      //     });
      //   });
      // });
    } else if (inputs.originalInputs?.type.includes('Invoice Status')) {
      console.log('>>>>>>   SEQUENCE 2. Invoice Status   <<<<<<');
      await processActions({
        inputs,
        actions: [
          {
            selectorOrXpath: '//*[contains(@href,"invoiceEntryPoint")]',
            wait: 3000,
          },
          {
            selectorOrXpath: '//input[@name="invoiceNumber"]',
            inputValue: '{invNo}',
          },
          {
            selectorOrXpath: '//input[@value="Submit"]',
            wait: 10000,
          },
        ],
      });
      if (await helper.checkXpathSelector('//*[contains(text(),"Invoice not found")]')) {
        await context.evaluate(() => {
          const tr = document.createElement('tr');
          const div = document.createElement('div');
          div.setAttribute('id', 'srchStatus');
          div.setAttribute('column', 'INVC ');
          div.setAttribute('text', 'Invoice Not Found');
          tr.appendChild(div);
          document.body.appendChild(tr);
        });
      } else if (await helper.checkXpathSelector('//h2[contains(text(),"Invoice Status")]')) {
        await context.evaluate(() => {
          const tr = document.createElement('tr');
          const div = document.createElement('div');
          div.setAttribute('id', 'srchStatus');
          div.setAttribute('text', 'Invoice Found');
          tr.appendChild(div);
          document.body.appendChild(tr);
        });
      }
    } else if (inputs.originalInputs?.type.includes('Account Balance Information')) {
      console.log('>>>>>>   SEQUENCE 1. Account Balance Information   <<<<<<');
      await processActions({
        inputs,
        actions: [
          {
            selectorOrXpath: '//*[contains(@href,"accountBalanceInfo")]',
            wait: 5000,
          },
        ],
      });
      await context.evaluate(() => {
        const headers = document.querySelectorAll('tr th[class="grid1_header"]');
        const headerMap = Array.from(headers).reduce((map, header, index) => {
          const headerText = header.textContent.trim().replace(/\n+/g, '');
          if (headerText) {
            // eslint-disable-next-line no-param-reassign
            map[index + 1] = headerText;
          }
          return map;
        }, {});
        const rows = document.querySelectorAll('form[name="actBalInfo"] div table tbody tr');
        rows.forEach((row) => {
          const cells = row.querySelectorAll('td');
          cells.forEach((cell, index) => {
            const headerText = headerMap[index + 1];
            if (headerText) {
              cell.setAttribute('column', headerText);
              const div = document.createElement('div');
              div.setAttribute('id', 'srchStatus');
              div.setAttribute('text', 'Check Found');
              document.body.appendChild(div);
            }
          });
        });
      });
      if (!await helper.checkXpathSelector('//*[contains(@class,"even_row_status")]')) {
        await context.evaluate(() => {
          const tr = document.createElement('tr');
          const div = document.createElement('div');
          div.setAttribute('id', 'srchStatus');
          div.setAttribute('column', 'INVC ');
          div.setAttribute('text', 'Trial Balance Not Found');
          tr.appendChild(div);
          document.body.appendChild(tr);
        });
      }
    }
    if (await helper.checkXpathSelector('//*[contains(text(),"combination is invalid")]')) {
      await context.evaluate(() => {
        const tr = document.createElement('tr');
        const div = document.createElement('div');
        div.setAttribute('id', 'srchStatus');
        div.setAttribute('column', 'INVC ');
        div.setAttribute('text', 'Invalid Login');
        tr.appendChild(div);
        document.body.appendChild(tr);
      });
    }
    if (await helper.checkXpathSelector('//*[contains(text(),"No records found with this entry")]')) {
      await context.evaluate(() => {
        const tr = document.createElement('tr');
        const div = document.createElement('div');
        div.setAttribute('id', 'srchStatus');
        div.setAttribute('column', 'INVC ');
        div.setAttribute('text', 'Dropdown Mismatch');
        tr.appendChild(div);
        document.body.appendChild(tr);
      });
    }
    if (await helper.checkXpathSelector('//*[contains(text(),"No payments made")]')) {
      await context.evaluate(() => {
        const tr = document.createElement('tr');
        const div = document.createElement('div');
        div.setAttribute('id', 'srchStatus');
        div.setAttribute('column', 'INVC ');
        div.setAttribute('text', 'Check Not Found');
        tr.appendChild(div);
        document.body.appendChild(tr);
      });
    }
  },
};
