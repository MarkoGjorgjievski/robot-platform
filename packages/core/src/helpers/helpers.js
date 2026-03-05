/* eslint-disable no-await-in-loop */
/* eslint-disable no-return-await */
/* eslint-disable no-shadow */
// this is a module containing some ready made functions
// to use it do the following in extract.js
/*
//at the bottom of the file, add the following in the module.exports object:
dependencies: {
    productDetails: 'extraction:product/details/stores/${store[0:1]}/${store}/${country}/extract',
    helperModule: 'module:helpers/helpers',
  },
//inside the implementation function
  const { helperModule: { Helpers }, productDetails } = dependencies;
  const helper = new Helpers(context);
//or in goto.js:
  dependencies: {
    helperModule: 'module:helpers/helpers',
    setZipCode: 'action:navigation/goto/setZipCode',
  },
//inside the implementation function
  const { helperModule: { Helpers }, setZipCode } = dependencies;
  const helper = new Helpers(context);
  // you can now use any of the function like that
  helper.function()
*/

const { preCompileFunctions } = require('../navigation/navigationHelperLibrary');

(async () => {
  module.exports.YAML = await preCompileFunctions.getYAMLs();
})();

module.exports.Helpers = class {
  constructor(context) {
    this.context = context;
  }

  // function which makes a backend fetch
  // eslint-disable-next-line class-methods-use-this
  async backendFetch(url, options, useLambda) {
    // @ts-ignore
    // eslint-disable-next-line no-undef
    if (useLambda === 'None') return await extractorContext.fetch(url, options);

    const headers = typeof options.headers === 'string' ? options.headers : JSON.stringify(options.headers);
    const body = JSON.stringify({ url, ...options, headers });

    let optn;
    let endpoint;
    if (useLambda === 'Windmill') {
      const apiKey = 'be3acd62c4154633ad79a9e95a058d4b2040c1fc43cc2c03f5a34366f3cd9cbd661e7f5a48a4b3ba7a08e8d447af85475ea56c2f1f15a5214c8b1a47ed9d652ff6cf32cab46f94cb52483c9cccf099b0';
      endpoint = `https://wm2.import.io/api/w/importio/jobs/run_wait_result/p/f/importio/naver?_apikey=${apiKey}`;
      optn = {
        ...options,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer 6vRr62th3LDnKaq9tZDGk2BT7XagaWdk',
        },
        body,
      };
    }
    if (useLambda === 'AWS') {
      endpoint = 'https://nofpyo6ehf.execute-api.us-east-2.amazonaws.com/default/go-naver-lambda';
      optn = {
        ...options,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      };
    }
    console.log(`The fetch is called with options: ${JSON.stringify(optn)}`);
    // @ts-ignore
    // eslint-disable-next-line no-undef
    return await extractorContext.fetch(endpoint, optn).then(res => res.text()).then(txt => ({
      text: () => {
        try {
          const parsed = JSON.parse(txt);
          if (typeof parsed === 'string') return parsed;
          if (typeof parsed === 'object') return txt;
          return parsed;
        } catch (error) {
          return txt;
        }
      },
      json: () => JSON.parse(txt),
    }));
  }

  // function which makes a fetch
  async fetch(url, headers, {
    method = 'GET', mode = 'cors', credentials = 'include', redirect = 'follow', body, ...rest
  }, { text = false, json = true, browserFetch = false, useLambda = 'None' }) {
    const fetchOptions = browserFetch ? {
      method, mode, credentials, redirect, body, ...rest,
    } : { method, headers, body, ...rest };
    const lambdaStr = useLambda !== 'None' ? ` --using lambda ${useLambda}` : '';
    console.log(`Using ${browserFetch ? 'front' : 'back'}-end fetch: ${method}${lambdaStr}`, { headers, ...fetchOptions });
    // @ts-ignore
    if (typeof extractorContext !== 'undefined' && !browserFetch) {
      // @ts-ignore
      // eslint-disable-next-line no-undef
      return await this.backendFetch(url, fetchOptions, useLambda).then((r) => {
        if (text) return r.text();
        if (json) return r.json();
        return r;
      });
    }
    return await this.context.evaluate((url, headers, fetchObj, { text, json }) => {
      try {
        return fetch(url, { headers: new Headers(headers), ...fetchObj }).catch((e) => {
          console.log('Something happened 1');
          console.log(e);
          return e;
        }).then((r) => {
          if (text) return r.text();
          if (json) return r.json();
          return r;
        })
          .catch((e) => {
            console.log('Something happened 2');
            console.log(e);
            return e;
          });
      } catch (error) {
        console.log('Something happened 3');
        console.log(error);
        return null;
      }
    }, url, headers, fetchOptions, { text, json }).catch((e) => {
      console.log('Something happened 3');
      console.log(e);
      return e;
    });
  }

  // function to use when making a fetch to an API
  // successCallback function which returns a boolean indicating if a retry is needed
  // options {method = 'GET', mode = 'cors', credentials = 'include', body, ...rest }
  async fetchRetry(url, headers, options, returnObj, retries = 1, successCallback = res => res?.ok, waitingTime = 1000, { blockNThrow = true, throwErr = false } = {}) {
    let index = 0;
    while (index <= retries) {
      index += 1;
      console.log(`Calling fetch nb: ${index} to url: ${url}, ${JSON.stringify(returnObj)}`);
      if (Object.keys(headers || {}).length) {
        console.log('Headers: ');
        console.log(headers);
      }
      if (options.body) {
        console.log('Body as string: ');
        console.log(options.body);
      }
      try {
        const result = await this.fetch(url, headers, options, returnObj).catch(console.log);
        console.log('Fetch finsihed and produced: (next log may not display if too big)');
        console.log(result);
        console.log('result truncated', `${result}`.slice(0, 10));
        if (await successCallback(result)) return result;
        console.log(`fetch didn't succeed for retry: ${index} - success callback failed`);
        await new Promise(resolve => setTimeout(resolve, waitingTime));
      } catch (error) {
        console.log(`fetch didn't succeed for retry: ${index}`, error);
        await new Promise(resolve => setTimeout(resolve, waitingTime));
      }
    }
    if (throwErr) await this.throwError('Fetch failed');
    if (blockNThrow) await this.throwError('Fetch failed, showing block', { throwNBlock: true });
    return false;
  }

  // Function which checks if the provided string is a CSS
  async isValidCSS(selectorToCheck) {
    if (!selectorToCheck) return false; // allow passthrough of empty values to a false value

    // disable logs
    const oldLog = console.log;
    console.log = () => {};
    const isValidCSS = await this.context.evaluate((selector) => {
      try { document.createDocumentFragment().querySelector(selector); return true; } catch (e) { return false; }
    }, selectorToCheck);

    console.log = oldLog;
    if (isValidCSS) return selectorToCheck;
    return false;
  }

  // Function which checks if the provided string is a valid Xpath
  async isValidXpath(selectorToCheck) {
    if (!selectorToCheck) return false; // allow passthrough of empty values to a false value

    // disable logs
    const oldLog = console.log;
    console.log = () => {};
    const isValidXpath = await this.context.evaluate((selector) => {
      try { document.evaluate(selector, document, null, XPathResult.ANY_TYPE, null); return true; } catch (e) { return false; }
    }, selectorToCheck);

    console.log = oldLog;
    if (isValidXpath) return selectorToCheck;
    return false;
  }

  // function which controls the way an error is thrown and an ip is blocked
  async throwError(errorMessage, {
    throwNBlock = false, blockOnLast = false, blockedCode = 503, noThrowOnLast = false, log = false, treatLastXAsLast = 0,
  } = {}) {
    if (log) console.log(log);
    const { maxRetries, retryNumber } = this.context.retryContext;
    // const isLastRetry = +retryNumber > +maxRetries;
    // const isOneOfXlastRetries = treatLastXAsLast > +maxRetries - retryNumber;
    const isRetryTreatedAsLast = +retryNumber >= +maxRetries || treatLastXAsLast > +maxRetries - retryNumber;
    console.log(`isRetryTreatedAsLast: ${isRetryTreatedAsLast}, retryNumber: ${retryNumber}, maxRetries:${maxRetries}`);
    if (throwNBlock && !isRetryTreatedAsLast) await this.context.reportBlocked(blockedCode, errorMessage);
    if (!isRetryTreatedAsLast) throw new Error(errorMessage);
    // handle case of last retry
    const shouldRetry = !(parseInt(this.context.retryContext.maxRetries, 10) <= parseInt(this.context.retryContext.retryNumber, 10));
    if (throwNBlock) await this.context.reportBlocked(blockedCode, errorMessage);
    if (shouldRetry) throw new Error(errorMessage);
    if (noThrowOnLast) return console.log(errorMessage);
    if (blockOnLast || throwNBlock) await this.context.reportBlocked(blockedCode, errorMessage);
    throw new Error(errorMessage);
  }

  // Function which adds an element to the document
  async addItemToDocument(key, value, { parentSelector = '', type = 'div', htmlString = '' } = {}) {
    const inputs = {
      key, value, parentSelector, type, htmlString,
    };
    // Deactivate loggin to prevent cluttering the logs
    const oldLog = console.log;
    console.log = () => {};
    await this.context.evaluate((inputs) => {
      const addItemToDocument = ({
        key: id, value, parentSelector, type, htmlString,
      }) => {
        const htmlToAdd = `<${type} id="${id}"${htmlString}></${type}>`;
        const root = parentSelector ? document.querySelector(parentSelector) : document.body;
        root.insertAdjacentHTML('beforeend', htmlToAdd);
        // This allows to remove all potential HTML markers from the text
        document.querySelector(`#${id}`).innerHTML = value;
        // @ts-ignore
        document.querySelector(`#${id}`).textContent = document.querySelector(`#${id}`)?.innerText;
      };
      addItemToDocument(inputs);
    }, inputs);
    console.log = oldLog;
  }

  // Function which adds an array to the document as a list
  async addArrayToDocument(key, values, { parentID = '', type = 'div', clss = '' } = {}) {
    const inputs = {
      key, values, parentID, type, clss,
    };
    await this.context.evaluate((inputs) => {
      const addArrayToDocument = ({
        key: id, values, parentID, type, clss,
      }) => {
        const classStr = clss ? ` class="${clss}" ` : '';
        const htmlString = `<${type} id="${id}"${classStr}></${type}>`;
        const root = parentID ? document.querySelector(parentID) : document.body;
        root.insertAdjacentHTML('beforeend', htmlString);
        if (Array.isArray(values)) {
          const liStr = values.reduce((acc, val) => `${acc}<li>${val}</li>`, '<ul>');
          const innerHTML = `${liStr}</ul>`;
          document.querySelector(`#${id}`).innerHTML = innerHTML;
        } else {
          throw new Error('The provided values are not an array.');
        }
      };
      addArrayToDocument(inputs);
    }, inputs);
  }

  // Function which easily adds the url to the document
  async addJSONURLtoDocument(key, lastPartOnly) {
    const url = await this.context.evaluate(() => window.location.href);
    const urlParts = url ? url.split('/') : [];
    if (lastPartOnly) return await this.addItemToDocument(key, urlParts[urlParts.length - 1]);
    return await this.addItemToDocument(key, url);
  }

  // Function which easily adds the url to the document
  async addURLtoDocument({ depth, currentIndex }) {
    const url = await this.context.evaluate(() => window.location.href);
    const uuid = Date.now().toString(36) + Math.random().toString(36).slice(2);
    return await this.addItemToDocument(`addedURLToDocument_${uuid}`, '', { parentSelector: 'html > head', type: 'link', htmlString: `href="${url}" depth="${depth || 0} iter="${currentIndex || 0}"` });
  }

  // Function which easily checks if a selector exists, and returns it, or returns false
  async checkCSSSelector(selector) {
    return await this.context.evaluate((selector) => {
      const elem = document.querySelector(selector);
      return !!elem;
    }, selector);
  }

  // Function which easily checks if a selector exists, and returns it, or returns false
  async checkXpathSelector(selector) {
    return await this.context.evaluate((selector) => {
      const elem = document.evaluate(selector, document, null, XPathResult.ANY_UNORDERED_NODE_TYPE, null);
      return elem ? !!elem.singleNodeValue : false;
    }, selector);
  }

  // Function which checks if a substring is in the url
  async checkURLFor(substring) {
    const url = this.context.evaluate(() => window.location.href);
    return url.includes(substring);
  }

  // Function which checks if the provided object of selectors is there then navigate and click
  async checkAndClick(selector, input, type = 'CSS') {
    if (!await this.checkSelector(selector, type)) return;
    await Promise.all([
      !input ? await this.ifThereClickOnIt(selector) : await this.context.setInputValue(selector, input).catch(),
    ]).catch();// do nothing if an error arise
  }

  // Function which checks a selecor
  async checkSelector(selector, type = 'css') {
    if (selector === '') return false; // allows to provide empty selector
    let elemIsThere;
    if (type.toLowerCase() === 'xpath') elemIsThere = await this.checkXpathSelector(selector);
    else if (type.toLowerCase() === 'css') elemIsThere = await this.checkCSSSelector(selector);
    else return false;
    return elemIsThere;
  }

  // Function which checks if the provided object of selectors is there then returns the value of a property
  async checkAndReturnProp(selector, type, property) {
    if (!await this.checkSelector(selector, type)) return null;
    return await this.context.evaluate(({ selector, property, type }) => {
      let elem;
      if (type.toLowerCase() === 'xpath') elem = document.evaluate(selector, document, null, XPathResult.ANY_UNORDERED_NODE_TYPE, null).singleNodeValue;
      else if (type.toLowerCase() === 'css') elem = document.querySelector(selector);
      return elem[property] || (elem?.getAttribute ? elem?.getAttribute(property) : null);
    }, { selector, property, type });
  }

  // Function which sets the attribute of a an element
  async checkAndSetProp(selector, value, type, property) {
    if (!await this.checkSelector(selector, type)) return null;
    return await this.context.evaluate(({ selector, property, type, value }) => {
      let elem;
      if (type.toLowerCase() === 'xpath') elem = document.evaluate(selector, document, null, XPathResult.ANY_UNORDERED_NODE_TYPE, null).singleNodeValue;
      else if (type.toLowerCase() === 'css') elem = document.querySelector(selector);
      elem?.setAttribute(property, value);
      return elem?.[property];
    }, { selector, property, type, value });
  }

  // Function which waits without throwing an error, handling long timeouts
  async optionalWait(selector, timeout, type = 'CSS') {
    if (!selector) return false; // allow to provide empty selector
    const hardcodedLimit = 30000; // 30 seconds
    let remaining = parseInt(timeout, 10);
    const fct = type.toLowerCase() === 'css' ? 'waitForSelector' : 'waitForXPath';

    while (remaining > 0) {
      const waitTime = Math.min(hardcodedLimit, remaining);
      try {
        await this.context[fct](selector, { timeout: waitTime });
        console.log(`The following selector was found: ${selector} within timeout: ${timeout}`);
        return true; // Selector found
      } catch (error) {
      // If not found, reduce remaining time and retry
        remaining -= waitTime;
      }
    }

    console.log(`The following selector was not found: ${selector} after timeout: ${timeout}`);
    return false; // Timeout exceeded without finding selector
  }

  // Function which adds an attribute to the matching elements
  async addAttributeToMatches({ xpath, css = '', xpathDoc = '', attribute }) {
    if (css) {
      await this.context.evaluate(({ sel, attribute: str }) => {
        // @ts-ignore
        [...document.querySelectorAll(sel)].forEach(el => el.setAttribute(str.split('=')[0], str.split('=')[1]));
      }, { css, attribute })
        .catch(err => console.log(`Adding extracted attribute to elems matching css: ${css} failed with ${err}`));
    }
    if (xpath) {
      await this.context.evaluate(({ xpath, xpathDoc, attribute: str }) => {
        const getXPathArray = (pth, doc) => {
          const results = document.evaluate(pth, doc || document, null, XPathResult.ORDERED_NODE_ITERATOR_TYPE);
          const nodesArray = [];
          let node = results.iterateNext();
          while (node) {
            if (node.nodeType === 1) nodesArray.push(node);
            // @ts-ignore
            if (node.nodeType === 2) nodesArray.push(node.ownerElement);
            if (node.nodeType === 3) nodesArray.push(node.parentElement);
            node = results.iterateNext();
          }
          return nodesArray;
        };
        const root = xpathDoc ? getXPathArray(xpathDoc)[0] : document;
        getXPathArray(xpath, root).forEach(el => el.setAttribute(str.split('=')[0], str.split('=')[1]));
      }, { xpath, xpathDoc, attribute })
        .catch(err => console.log(`Adding extracted attribute to elems matching xpath: ${xpath} failed with ${err}`));
    }
  }

  // Function which triggers a download of all the screen captures specified in the YAMl file
  async appendScreenCaptures(inputs, YAML, schemaYAML) {
    // Deactivate loggin to prevent cluttering the logs
    const oldLog = console.log;
    console.log = () => {};

    const yamlJSON = Object.values(YAML).find(el => el.key === schemaYAML);

    // get all fields with screencapture
    const fields = yamlJSON.fields.filter(field => field.screenCapture);
    const obj = {};
    for (let index = 0; index < fields.length; index += 1) {
      const { name, screenCapture, downloadContent } = fields[index];
      /* eslint-disable no-undef */
      // @ts-ignore
      if (typeof extractorContext !== 'undefined') {
        oldLog('Taking screenshot');
        const screenShot = await this.context.screenshot({ type: screenCapture, fullPage: null });
        oldLog(downloadContent);
        if (downloadContent === true || `${downloadContent}`.toLowerCase() === 'true') {
          const uuid = Date.now().toString(36) + Math.random().toString(36).slice(2);
          const fileName = `${name}${uuid}`;
          oldLog('unique filename:', `${fileName}.${screenCapture}`);
          const {
            body, url, ...rest
            // @ts-ignore
          } = await extractorContext.downloadURL(screenShot, `${fileName}.${screenCapture}`);
          /* eslint-enable no-undef */
          obj[name] = [{
            text: url,
            ...fields[index],
            url,
            ...rest,
          }];
          obj[`${name}_fileName`] = [{
            text: `${fileName}.${screenCapture}`,
            ...fields[index],
          }];
        } else {
          obj[name] = [{
            text: screenShot,
            ...fields[index],
          }];
        }
      } else {
        oldLog('Screenshots are disabled on local or remote runs');
      }
    }
    console.log = oldLog;
    // eslint-disable-next-line no-param-reassign
    inputs.injectable = {
      ...inputs.injectable,
      ...obj,
    };
  }

  // Function which adds an attribute (the one prvided or a default one) to all fields and records that were just extracted
  async addAttributeToExtractedRecords(attrParam, YAML) {
    const attribute = attrParam === true || attrParam === 'true' || !attrParam ? '__extracted=true' : attrParam;
    // Deactivate loggin to prevent cluttering the logs
    const oldLog = console.log;
    console.log = () => {};
    const rawData = await this.context.data();

    const confiPath = rawData.slice(-1)[0].extractionConfig;

    const yamlJSON = YAML[confiPath];

    if (yamlJSON.regionsSelector) oldLog('++++++++++++++++++ regionsSelector is not supported for adding attribute to extracted records');

    if (yamlJSON.recordSelector || yamlJSON.recordXPath) {
      // add attribute to recordXpath or record Selector
      await this.addAttributeToMatches({ css: yamlJSON.recordSelector, xpath: yamlJSON.recordXPath, attribute });
    } else {
      // add attribute to all the extracted fields
      const allCollectedXpaths = this.getAllXPaths(rawData);
      for (let index = 0; index < allCollectedXpaths.length; index += 1) {
        const [[xpathDoc, xpaths]] = Object.entries(allCollectedXpaths[index]);
        for (let pathIndex = 0; pathIndex < xpaths.length; pathIndex += 1) {
        // eslint-disable-next-line no-await-in-loop
          await this.addAttributeToMatches({ xpath: xpaths[pathIndex], xpathDoc, attribute });
        }
      }
    }
    console.log = oldLog;
  }

  // Function which generates a list of all the xpath extracted from a raw data file.
  // eslint-disable-next-line class-methods-use-this
  getAllXPaths(rawData) {
    return rawData.flatMap(({ data }) => data?.flatMap(({ group, xpath: grpXpath }) => ({
      [grpXpath]: group?.flatMap(row => Object.entries(row)
        .flatMap(([, values]) => values)
        .flatMap(({ xpath }) => xpath)),
    })));
  }

  // Function which waits and checks if the provided object of selectors is there and count them
  async waitAndCount(selector, timeout) {
    await this.optionalWait(selector, timeout);
    if (!await this.checkSelector(selector, 'CSS')) return 0;
    return await this.context.evaluate(({ selector }) => {
      const elems = document.querySelectorAll(selector);
      return elems.length;
    }, { selector });
  }

  // Function which properly handles a page reload
  async reload(timeoutOptions) {
    const defTimeOut = 3000;
    const { pause = timeoutOptions || defTimeOut } = timeoutOptions || {};
    await this.context.reload();
    await new Promise(resolve => setTimeout(resolve, pause));
  }

  // Make a correct opt Tag string to apend to URL
  // eslint-disable-next-line class-methods-use-this
  async make_opt_tags(params) {
    const { optTags } = params;
    const preSavedValues = {
      applyIgnoreVBAndCookies: '"cookies":[],"storage":{}',
      turnOffTableNormalize: '"table_normalize": false',
    };
    const finalOptTags = `${optTags || ''}${Object.entries(preSavedValues)
      .filter(([key]) => params[key])
      .map(([, value]) => value)
      .join(',')}`;

    return finalOptTags ? `#[!opt!]{${finalOptTags}}[/!opt!]` : '';
  }

  // Function which makes a click
  async ifThereClickOnIt(selector, timeoutOptions, reloadPage = false) {
    const defTimeOut = 3000;
    const {
      wait = timeoutOptions || defTimeOut,
      click = timeoutOptions || defTimeOut,
      reload = timeoutOptions || defTimeOut,
    } = timeoutOptions || {};
    if (!selector) return console.log('No selector provided to click on.');
    if (await this.optionalWait(selector, wait) === false) return false;

    const hasItem = await this.checkSelector(selector, 'CSS');
    if (hasItem) {
      let usedDocumentClick = false;
      // try both click
      await this.context.click(selector, { timeout: click })
        .catch(async (error) => {
          // context click did not work so we retry it
          console.log('Context click did not work, retrying.');
          console.log(error);
          return await this.context.click(selector, { timeout: click });
        })
        .catch(async (error) => {
          // context click did not work and that is ok
          console.log('Context click did not work, defaulting to document.click');
          console.log(error);
          usedDocumentClick = await this.context.evaluate((selector) => {
            const elem = document.querySelector(selector);
            if (elem) {
              elem.click();
              return true;
            }
            return false;
          }, selector);
        })
        .then(() => reloadPage && this.reload(reload));
      console.log(`Clicking on ${selector} is done. Document click was ${usedDocumentClick ? '' : 'not '}used`);
      return true;
    }
    return false;
  }

  // Function which goes from a search result to a product page
  async goFromSearchToDetails({
    searchResultsCSS = 'li.estore_product_container', // should match all the search results, not just the first one
    acceptCookiesCSS = '#onetrust-accept-btn-handler',
    productDetailsPageLoadedCSS = '#estore_productpage_template_container',
    timeoutOptions,
    failIfMultipleResults = false,
  }) {
    const defTimeOut = 3000;
    const {
      wait = timeoutOptions || defTimeOut,
      click = timeoutOptions || defTimeOut,
    } = timeoutOptions || {};

    // accepts the cookies
    await this.ifThereClickOnIt(acceptCookiesCSS, { click, wait });

    // check if there are results on the page
    const nbResults = await this.waitAndCount(searchResultsCSS, wait);
    console.log(`The current page has ${nbResults} results for selector: ${searchResultsCSS}`);

    // navigate to the first result of the page
    if ((!failIfMultipleResults && nbResults > 0) || (failIfMultipleResults && nbResults === 1)) {
      await this.ifThereClickOnIt(searchResultsCSS, { click, wait }); // will automatically click on the first one found in the dom
      await this.optionalWait(productDetailsPageLoadedCSS, wait);
      if (!await this.checkSelector(productDetailsPageLoadedCSS, 'CSS')) {
        console.log('ERROR: Failed to load product details page');
        return this.context.halt();
      }
    } else if (await this.checkSelector(productDetailsPageLoadedCSS, 'CSS')) {
      console.log('The product details page already loaded');
    } else {
      console.log('The results appearing on the current page are not valid');
      return this.context.halt();
    }
    return null;
  }

  // Function which search for a list of txt within an iframe
  async searchInFrame(frameSelector, listToSearch) {
    if (frameSelector === '') return false; // allow for empty string selector
    // wait for the frame
    await this.optionalWait(frameSelector);
    // make sure the frame finished loading
    if (!await this.checkSelector(frameSelector, 'CSS')) return false;
    if (!await this.waitForFrameToLoad(frameSelector)) return false;
    try {
      return this.context.evaluateInFrame(frameSelector, (listToSearch) => {
        if (document && document.body) {
          return listToSearch.some(txt => document.body.innerText.search(txt) > -1);
        }
        return false;
      }, listToSearch);
    } catch (error) {
      console.log(error);
      return false;
    }
  }

  // Function which search first in the dom then in the iframe
  async searchInFullPage(frameSelector, listToSearch) {
    return await this.context.evaluate((listToSearch) => {
      if (document && document.body) {
        return listToSearch.some(txt => document.body.innerText?.search(txt) > -1);
      }
      return false;
    }, listToSearch) || await this.searchInFrame(frameSelector, listToSearch).catch(() => false);
  }

  // Function which waits for a selector to disappear
  async waitToDisappear(selector, options) {
    const { timeout = Number(options) ? options : 500 } = options || {};
    let loopCounter = 0;
    let isThere = false;
    const waitingTime = 500;
    const limit = Math.ceil(timeout / waitingTime);
    while (loopCounter < limit && !isThere) {
      loopCounter += 1;
      isThere = await this.checkSelector(selector, 'CSS');
      await new Promise(resolve => setTimeout(resolve, waitingTime));
    }
  }

  // Function which allows to wait for an element within an iframe or a shadowroot
  async waitForInDifferentContext(selector, documentSelector, options) {
    const { timeout = Number(options) ? options : 500 } = options || {};
    console.log('..waitForLoader..:', documentSelector);
    const waitingTime = 500;
    const limit = Math.ceil(timeout / waitingTime);
    await this.optionalWait(documentSelector);
    const rootIsThere = await this.context.evaluate((docSel) => {
      const docOrIframe = document.querySelector(docSel);
      const doc = docOrIframe?.contentDocument || docOrIframe?.shadowRoot || docOrIframe;
      console.log('=====================');
      console.log(`the document context node is iframe ${!!docOrIframe?.contentDocument}, shadowRoot: ${!!docOrIframe?.shadowRoot}, elem: ${!!docOrIframe}`);
      console.log(doc);
      console.log('=====================');
      return !!doc;
    }, documentSelector);
    if (!rootIsThere) {
      console.log('Root document for waiting loop is not there.');
      return false;
    }
    let loopCounter = 0;
    let isThere = false;
    while (loopCounter < limit && !isThere) {
      loopCounter += 1;
      isThere = await this.context.evaluate(([sel, docSel]) => {
        const docOrIframe = document.querySelector(docSel);
        const doc = docOrIframe?.contentDocument || docOrIframe?.shadowRoot || docOrIframe;
        console.log(`Checking if the following selector is there: ${sel}`);
        return !!doc?.querySelector(sel);
      }, [selector, documentSelector]);
      await new Promise(resolve => setTimeout(resolve, waitingTime));
    }
    console.log(`The wait for selector ${selector} within context ${documentSelector} returned ${isThere}`);
    return isThere;
  }

  // Check if an iframe fully loaded
  async waitForFrameToLoad(selector, options) {
    if (selector === '') return false; // allow for empty selector
    const { timeout = Number(options) ? options : 500, selectorType: type = 'css' } = options || {};
    if (!await this.checkSelector(selector, type)) return false;
    const waitingTime = 500;
    const limit = Math.ceil(timeout / waitingTime);
    let loopCounter = 0;
    let isLoaded = false;
    while (loopCounter < limit && !isLoaded) {
      loopCounter += 1;
      isLoaded = await this.context.evaluate((sel) => {
        const docOrIframe = document.querySelector(sel);
        if (!docOrIframe) return false;
        const doc = docOrIframe.contentDocument || docOrIframe; // does not support shadowRoot
        return doc.readyState === 'complete';
      }, selector);
      console.log(`Checking if the following frame selector is loaded: ${selector}, -> ${isLoaded}`);
      await new Promise(resolve => setTimeout(resolve, waitingTime));
    }
    return isLoaded;
  }

  // remove script tag breaking the html extraction
  async removeScriptsWhichContains(text) {
    return this.context.evaluate((text) => {
      // @ts-ignore
      [...document.querySelectorAll('script')]
        .map(node => ({ node, textContent: node.textContent, src: node.src }))
        .filter(({ textContent, src }) => textContent.includes(text) || src.includes(text))
        .forEach(({ node }) => node.remove());
    }, text);
  }

  // hijack netwrork requests
  // use first like that:
  // await helpers.hijackRequests();
  // then use inside a context.evaluate like that:
  // await global.___getResponse(filterFct, resultFct, triggerFct);
  // triggerFct(): is a function to initiate the network request, for instance: () => document.querySelector('sel').click()
  // filterFct(url, method): is a function to identify the correct network call, for instance: (url, method) => url.includes('.ts') && method === 'GET';
  // resultFct(response, url, method): is a function to extract and return what is wanted from the network call. for instance: (response, url, method) => JSON.parse(response);
  // the function ___getResponse returns the result from resultFct
  async hijackRequests(restoreAfterCatch = false) {
    await this.context.evaluate((restoreAfterCatch) => {
      // @ts-ignore
      // eslint-disable-next-line no-underscore-dangle
      global.___getResponse = (filterFct, resultFct, triggerFct, closeFct = triggerFct) => Promise.race([new Promise((resolve) => {
        const originalRequestOpen = XMLHttpRequest.prototype.open;
        XMLHttpRequest.prototype.open = function (method, url, ...args) {
          if (filterFct(url, method)) {
            this.addEventListener('load', function () {
              try {
                resolve(resultFct(this.response, url, method));
              } catch (error) {
                resolve(null);
              }
            });
          }
          originalRequestOpen.apply(this, [method, url, ...args]);
        };
        triggerFct();
        new Promise(resolve => setTimeout(resolve, 1e3))
          .then(() => {
            if (restoreAfterCatch) XMLHttpRequest.prototype.open = originalRequestOpen;
            closeFct();
          });
      }),
      new Promise(resolve => setTimeout(resolve, 5e3))]);
    }, restoreAfterCatch);
  }

  // function to use in case of cloudflare kind of waiting block
  async waitBlocking(waitAfterNavObject = {}) {
    const { selector, wrongRedirectSelector, selectorType, delay } = waitAfterNavObject;
    if (!wrongRedirectSelector && !selector) return null;
    try {
      await this.optionalWait(wrongRedirectSelector, delay);
      const isWronglyRedirected = await this.checkSelector(wrongRedirectSelector, selectorType);
      if (isWronglyRedirected) {
        console.log('Blocked');
        return this.context.reportBlocked(702, 'Soft blocked');
      }
    } catch (error) {
      // check for cloud flare type of wait
      const isDelayed = await this.checkSelector(selector, selectorType);

      if (isDelayed) await new Promise(resolve => setTimeout(resolve, delay));
      else throw error;
    }
    return null;
  }

  // function to check and solve a captcha
  async solveCaptcha({
    captchaSelectors, hardBlockChecks, maxCaptcha, validPageSelector, isCaptchaInNestedIframe, submitCaptchaButtonCSS, inputs,
  }, { timeout, timeoutOffset = 1000 }) {
    let captchaCounter = 0;
    const captchas = Object.keys(captchaSelectors);
    const solvers = {
      RECAPTCHA: { key: 'grecaptcha', funct: 'execute' },
      GEETEST: { key: '_geetest', funct: '_solve' },
    };

    const isNotHardBlocked = async () => {
      for (let index = 0; index < captchas.length; index += 1) {
        const captcha = captchas[index];
        const captchaSelector = captchaSelectors[captcha].inputElement || captchaSelectors[captcha];
        // check if we are hadblocked
        const isHardBlocked = hardBlockChecks ? await this.searchInFullPage(captchaSelector, hardBlockChecks) : false;
        if (isHardBlocked) {
          console.log('Blocked');
          await this.context.reportBlocked(700, 'Hard blocked');
          return false;
        }
      }
      return true;
    };

    const isThereACaptcha = async (captchaCount) => {
      const prophasBeenSeen = 'hasbeenseen';
      const waitTime = captchaCount ? timeout + timeoutOffset : timeout; // if it isn't the first time we add a static timeout offset
      // check if one of the captcha is there
      for (let index = 0; index < captchas.length; index += 1) {
        const captcha = captchas[index];
        const captchaSelector = captchaSelectors[captcha].imageElement || captchaSelectors[captcha].inputElement || captchaSelectors[captcha];
        // wait for the captchas to be there
        await this.optionalWait(captchaSelector, waitTime);
        const isCaptchaFramePresent = await this.checkSelector(captchaSelector, 'CSS');
        const hasbeenseen = await this.checkAndReturnProp(captchaSelector, 'CSS', prophasBeenSeen);
        const isOnValidPage = validPageSelector ? await this.checkSelector(validPageSelector, 'CSS') : false;
        const endtext = validPageSelector ? ` and the page is ${isOnValidPage ? '' : 'not '} a valid data page` : '';
        const hasbeenSeenText = hasbeenseen ? ', but has already been seen - it will be ignored' : '';
        console.log(`Captcha of type: ${captcha} is ${isCaptchaFramePresent ? '' : 'not '}present${hasbeenSeenText}${endtext}`);
        if (isCaptchaFramePresent && !hasbeenseen) {
          await this.checkAndSetProp(captchaSelector, 'seen', 'CSS', prophasBeenSeen);
          return captcha;
        }
      }
      return '';
    };

    let captchaPresent;
    // eslint-disable-next-line no-cond-assign
    while ((captchaPresent = await isThereACaptcha(captchaCounter)) && captchaCounter < maxCaptcha && await isNotHardBlocked()) {
      const solver = solvers[captchaPresent]?.solver || captchaSelectors[captchaPresent]?.solver || this.context.solveCaptcha;
      captchaCounter += 1;
      if (isCaptchaInNestedIframe) {
        // @ts-ignore
        await this.context.evaluateInFrame('iframe', ({ key, funct }) => window[key][funct](), solvers[captchaPresent]);
      } else {
        let cpt = { type: captchaPresent, inputElement: 'iframe' };
        if (captchaSelectors[captchaPresent] === Object(captchaSelectors[captchaPresent])) {
          // @ts-ignore
          cpt = { ...cpt, ...captchaSelectors[captchaPresent] };
          if (cpt.solver) {
            cpt = {
              ...cpt,
              questionElementText: await this.checkAndReturnProp(cpt.questionElement, 'CSS', 'textContent'),
              imageElementText: await this.checkAndReturnProp(cpt.imageElement, 'CSS', 'src'),
              fetchRetry: this.fetchRetry.bind(this),
              inputs,
            };
          }
        }
        try {
          console.log(solver, solvers[captchaPresent]?.solver, captchaSelectors[captchaPresent]?.solver, this.context.solveCaptcha);
          const solved = await solver(cpt, { timeout, timeoutOffset });
          console.log(solved);
          if (cpt.questionElement) {
            await this.checkAndClick(cpt.inputElement, solved, 'CSS');
          }
        } catch (error) {
          throw new Error(`Capctha solver error: ${error.message}`);
        }
        // wait a sec
        await new Promise(resolve => setTimeout(resolve, timeout));
      }
      if (submitCaptchaButtonCSS) {
        await this.ifThereClickOnIt(submitCaptchaButtonCSS);
        // this would trigger a page load and requires a wait
        // wait up the timeout for the submit button to disappear
        const maxLoopIter = 3;
        let index = 0;
        while (await this.checkCSSSelector(submitCaptchaButtonCSS) && index < maxLoopIter) {
          await new Promise(resolve => setTimeout(resolve, timeout));
          index += 1;
        }
      }
      console.log('Captcha submitted and should be resolved.');
    }
    if (captchaCounter >= maxCaptcha && await isThereACaptcha()) {
      console.log('Blocked');
      return this.context.reportBlocked(701, 'Blocked with too many captcha');
    }
    return null;
  }

  // Goto which solve captchas
  async gotoWithCaptchaSolver(url, {
    inputs = {},
    antiCaptchaOptions = { type: ['GEETEST', 'HCAPTCHA', 'RECAPTCHA', 'PERIMETERX', 'IMAGECAPTCHA'] },
    gotoOptions = {},
    captchaTimeout = 6000, // controls the waitForCaptcha and waitForNavigation
    timeoutOffset = 1000, // controls a static timeout offset for repeated captcha
    userAgent = '',
    submitCaptchaButtonCSS = '',
    captchaSelectors = {
      HCAPTCHA: 'form#challenge-form', GEETEST: 'iframe[src^="https://geo.captcha-delivery.com/captcha/"]', RECAPTCHA: 'div.re-captcha', PERIMETERX: '#px-captcha iframe[style~="block;"]', IMAGECAPTCHA: { inputElement: 'form input[type=text][name]', imageElement: 'img.captcha-code' },
    }, // must be css
    isCaptchaInNestedIframe = false,
    validPageSelector = '',
    waitAfterNavObject = { wrongRedirectSelector: '//div[@id="sign-in-widget"][not(.//div[@class="re-captcha"])]', selector: '//span[contains(.,"Checking your browser before accessing")]', selectorType: 'XPATH', delay: 6000 }, // object to handle cloudflare type of wait
    hardBlockChecks = ['Vous avez été bloqué', 'You have been blocked'],
    maxCaptcha = 3,
  } = {}) {
    if (userAgent) {
      // 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/80.0.3987.163 Safari/537.36/xGHzvfMy-13'
      await this.context.setUserAgent(userAgent);
    }
    let responseStatus = {};
    try {
      responseStatus = await this.context.goto(url, { checkBlocked: false, antiCaptchaOptions, ...gotoOptions });
    } catch (error) {
      console.log(error);
      const statusCode = responseStatus?.status;
      if (statusCode) {
        console.log(`Goto failed, reporting blocked IP with code: ${statusCode}`);
        return this.context.reportBlocked(699, `Goto failed, reporting blocked IP with code: ${statusCode}`);
      }
      throw new Error(`Goto error: ${error.message}`);
    }
    console.log(`Started navigation to ${url}, response: ${responseStatus.status}`);
    await this.waitBlocking(waitAfterNavObject);

    await this.solveCaptcha({
      captchaSelectors, hardBlockChecks, maxCaptcha, validPageSelector, isCaptchaInNestedIframe, submitCaptchaButtonCSS, inputs,
    }, { timeout: captchaTimeout, timeoutOffset });

    // cehck for wrong redirect after capctha
    await this.waitBlocking(waitAfterNavObject);
    return responseStatus;
  }

  async randomClick(selectors) {
    if (!Array.isArray(selectors)) {
      console.log(`Invalid params passed, should receive an \`array\` instead received \`${typeof selectors}\``);
    }
    if (selectors.length === 0) {
      console.log('array is empty');
    }
    console.log('executing random click...');
    const randomSelector = Math.floor(Math.random() * selectors.length);
    this.ifThereClickOnIt(selectors[randomSelector]);
  }

  // Function which move a shadow root into the light
  async moveShadowToMainDom(shadowRootCSSSelector, index) {
    if (await this.optionalWait(shadowRootCSSSelector, 5000) === false) return false;
    await this.context.evaluate(({ selector, ind }) => {
      const id = `shadow-${ind}`;
      document.body.insertAdjacentHTML('beforeend', `<div id="${id}"></$div>`);
      const shadowElem = document.querySelector(selector)?.shadowRoot;
      document.querySelector(`#${id}`).innerHTML = shadowElem?.innerHTML;
    }, { selector: shadowRootCSSSelector, ind: index });
    return true;
  }

  // Function which use scrollintoView to scroll to specific element
  async scrollIntoView(elementSelectorCSS) {
    return this.context.evaluate((selectorCSS) => {
      const element = document.querySelector(selectorCSS);
      if (element) element.scrollIntoView({ behavior: 'smooth' });
    }, elementSelectorCSS);
  }

  async scrollBy(elementSelectorCSS, coefficient = 1) {
    return this.context.evaluate((selectorCSS, coef) => {
      document.querySelector(selectorCSS).scrollBy(0, document.querySelector(selectorCSS).scrollHeight * coef);
    }, elementSelectorCSS, coefficient);
  }

  // Function that scrolls until the stop condition is met
  async scrollToElementUntil(elementSelectorCSS, stopXPath, options, stopCSS = null) {
    const elementExists = (await this.optionalWait(elementSelectorCSS, 3000)) !== false;

    if (!elementExists) return;

    // timeout - total time for whole operation - ex. many scrolls
    // waitingTime - time between each scroll
    const { timeout = Number(options) ? options : 500, waitTime = 500 } = options || {};
    let loopCounter = 0;
    let isStop = false;
    const limit = Math.ceil(timeout / waitTime);
    while (loopCounter < limit && !isStop) {
      loopCounter += 1;

      await this.scrollIntoView(elementSelectorCSS);
      await new Promise(resolve => setTimeout(resolve, waitTime));
      if (stopXPath || stopCSS) isStop = await this.checkSelector(stopXPath || stopCSS, stopXPath ? 'XPath' : 'CSS');
    }
  }

  // Function that modifies the dom to mark all scrollable elements with a scrollID
  async getAllScrollablesBetweenElems(topElementCSS, targetElementCSS, doNotScrollXpath) {
    let iter = -1;
    const attr = '__scrollid';
    // give an id to the top element
    await this.checkAndSetProp(topElementCSS, '1', 'CSS', 'topElementID');
    // give an id to the target element
    await this.checkAndSetProp(targetElementCSS, '1', 'CSS', 'targetElementID');

    // rootXPATH to get all element-chilren above the target and below the top element
    const rootXPATH = `//body//*[@topElementID="1"]//*[not(local-name()="script")][not(local-name()="a")][not(.//*)][not(@${attr})][not(./ancestor::*[local-name()="svg"])][not(@aria-hidden="true")][not(./preceding-sibling::*[@targetElementID="1"])][not(./preceding-sibling::*//*[@targetElementID="1"])]`; // to look into

    return async () => {
      iter += 1;
      // set a scrollid everywhere
      const numberElements = await this.context.evaluate((selector, iter, nopeSelector, attr) => {
      // eslint-disable-next-line sonarjs/no-identical-functions
        const getXPathArray = (pth, doc = document) => {
          const results = document.evaluate(pth, doc || document, null, XPathResult.ORDERED_NODE_ITERATOR_TYPE);
          const nodesArray = [];
          let node = results.iterateNext();
          while (node) {
            if (node.nodeType === 1) nodesArray.push(node);
            // @ts-ignore
            if (node.nodeType === 2) nodesArray.push(node.ownerElement);
            if (node.nodeType === 3) nodesArray.push(node.parentElement);
            node = results.iterateNext();
          }
          return nodesArray;
        };
        const nopeArr = nopeSelector ? getXPathArray(nopeSelector) : [];
        const nodeArr = getXPathArray(selector)
        // keep only elements that are visible
          .filter(elem => (elem.offsetHeight && elem.getClientRects().length && !nopeArr.includes(elem)));
        const total = nodeArr.length - 1;
        nodeArr.forEach((el, idx) => el.setAttribute(attr, `${idx}/${total} - iter:${iter}`));
        return total;
      }, rootXPATH, iter, doNotScrollXpath, attr);
      return { numberElements, selectify: idx => `[${attr}='${idx}/${numberElements} - iter:${iter}']` };
    };
  }

  // Function that scrolls until the stop condition is met
  async scrollTarget(topElementCSS, targetElementCSS, stopXPath, doNotScrollXpath, { waitTime = 10, steps = 50 } = {}) {
    const setItems = await this.getAllScrollablesBetweenElems(topElementCSS, targetElementCSS, doNotScrollXpath);
    let round = await setItems();
    let index = 0;
    while (round.numberElements > 0) {
      if (stopXPath && await this.checkSelector(stopXPath, 'XPath')) break;
      await this.scrollToElementUntil(round.selectify(index), null, { timeout: waitTime, waitTime });
      index += steps;
      if (index >= round.numberElements) {
        await this.scrollToElementUntil(round.selectify(round.numberElements), null, { timeout: waitTime, waitTime });
        index = 0;
        round = await setItems();
      }
    }
  }

  // function which sets value of a dropdown, only supports CSS selector
  async dropDownValue(CSSSelector, optionSubstring) {
    if (!await this.checkSelector(CSSSelector, 'CSS')) return;
    await this.context.evaluate((selector, valueText) => {
      const dropdown = document.querySelector(selector);
      const desiredValue = dropdown.options.find(({ text }) => text.includes(valueText));

      if (!desiredValue) {
        console.log(`Option containing '${valueText}' not found`);
        return false;
      }
      console.log(`Option containing '${valueText}' was found: ${desiredValue}`);
      dropdown.value = desiredValue;
      const event = new Event('change', { bubbles: true });
      dropdown.dispatchEvent(event);
      return true;
    }, CSSSelector, optionSubstring);
  }

  // Delete nodes with #__input or others passed as an array
  async deleteDuplicateDOMElements(selectors) {
    await this.context.evaluate(async (passedSels) => {
      passedSels.forEach((selector) => {
        const elements = document.querySelectorAll(selector) || [];

        // If more than one element is found, remove all except the first one
        elements.forEach((element, index) => {
          if (index > 0) element.remove();
        });
      });
    }, selectors);
  }
};
