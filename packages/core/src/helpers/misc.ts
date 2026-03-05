import { optionalWait } from './wait.ts';
import { checkSelector, waitAndCount, addAttributeToMatches } from './dom.ts';

declare const extractorContext: any;

export async function throwError(context: any, errorMessage: string, {
  throwNBlock = false, blockOnLast = false, blockedCode = 503, noThrowOnLast = false, log = false as any, treatLastXAsLast = 0,
} = {}): Promise<void> {
  if (log) console.log(log);
  const { maxRetries, retryNumber } = context.retryContext;
  const isRetryTreatedAsLast = +retryNumber >= +maxRetries || treatLastXAsLast > +maxRetries - retryNumber;
  console.log(`isRetryTreatedAsLast: ${isRetryTreatedAsLast}, retryNumber: ${retryNumber}, maxRetries:${maxRetries}`);
  if (throwNBlock && !isRetryTreatedAsLast) await context.reportBlocked(blockedCode, errorMessage);
  if (!isRetryTreatedAsLast) throw new Error(errorMessage);
  const shouldRetry = !(parseInt(context.retryContext.maxRetries, 10) <= parseInt(context.retryContext.retryNumber, 10));
  if (throwNBlock) await context.reportBlocked(blockedCode, errorMessage);
  if (shouldRetry) throw new Error(errorMessage);
  if (noThrowOnLast) return console.log(errorMessage) as undefined;
  if (blockOnLast || throwNBlock) await context.reportBlocked(blockedCode, errorMessage);
  throw new Error(errorMessage);
}

export async function reload(context: any, timeoutOptions?: any): Promise<void> {
  const defTimeOut = 3000;
  const { pause = timeoutOptions || defTimeOut } = timeoutOptions || {};
  await context.reload();
  await new Promise(resolve => setTimeout(resolve, pause));
}

export async function make_opt_tags(params: any): Promise<string> {
  const { optTags } = params;
  const preSavedValues: Record<string, string> = {
    applyIgnoreVBAndCookies: '"cookies":[],"storage":{}',
    turnOffTableNormalize: '"table_normalize": false',
  };
  const finalOptTags = `${optTags || ''}${Object.entries(preSavedValues)
    .filter(([key]) => params[key])
    .map(([, value]) => value)
    .join(',')}`;
  return finalOptTags ? `#[!opt!]{${finalOptTags}}[/!opt!]` : '';
}

export async function ifThereClickOnIt(context: any, selector: string, timeoutOptions?: any, reloadPage: boolean = false): Promise<boolean | void> {
  const defTimeOut = 3000;
  const {
    wait = timeoutOptions || defTimeOut,
    click = timeoutOptions || defTimeOut,
    reload: reloadTimeout = timeoutOptions || defTimeOut,
  } = timeoutOptions || {};
  if (!selector) return console.log('No selector provided to click on.') as undefined;
  if (await optionalWait(context, selector, wait) === false) return false;
  const hasItem = await checkSelector(context, selector, 'CSS');
  if (hasItem) {
    let usedDocumentClick = false;
    await context.click(selector, { timeout: click })
      .catch(async (error: any) => {
        console.log('Context click did not work, retrying.');
        console.log(error);
        return await context.click(selector, { timeout: click });
      })
      .catch(async (error: any) => {
        console.log('Context click did not work, defaulting to document.click');
        console.log(error);
        usedDocumentClick = await context.evaluate((selector: string) => {
          const elem = document.querySelector(selector);
          if (elem) { (elem as HTMLElement).click(); return true; }
          return false;
        }, selector);
      })
      .then(() => reloadPage && reload(context, reloadTimeout));
    console.log(`Clicking on ${selector} is done. Document click was ${usedDocumentClick ? '' : 'not '}used`);
    return true;
  }
  return false;
}

export async function goFromSearchToDetails(context: any, {
  searchResultsCSS = 'li.estore_product_container',
  acceptCookiesCSS = '#onetrust-accept-btn-handler',
  productDetailsPageLoadedCSS = '#estore_productpage_template_container',
  timeoutOptions = undefined as any,
  failIfMultipleResults = false,
}): Promise<any> {
  const defTimeOut = 3000;
  const { wait = timeoutOptions || defTimeOut, click = timeoutOptions || defTimeOut } = timeoutOptions || {};
  await ifThereClickOnIt(context, acceptCookiesCSS, { click, wait });
  const nbResults = await waitAndCount(context, searchResultsCSS, wait);
  console.log(`The current page has ${nbResults} results for selector: ${searchResultsCSS}`);
  if ((!failIfMultipleResults && nbResults > 0) || (failIfMultipleResults && nbResults === 1)) {
    await ifThereClickOnIt(context, searchResultsCSS, { click, wait });
    await optionalWait(context, productDetailsPageLoadedCSS, wait);
    if (!await checkSelector(context, productDetailsPageLoadedCSS, 'CSS')) {
      console.log('ERROR: Failed to load product details page');
      return context.halt();
    }
  } else if (await checkSelector(context, productDetailsPageLoadedCSS, 'CSS')) {
    console.log('The product details page already loaded');
  } else {
    console.log('The results appearing on the current page are not valid');
    return context.halt();
  }
  return null;
}

export async function hijackRequests(context: any, restoreAfterCatch: boolean = false): Promise<void> {
  await context.evaluate((restoreAfterCatch: boolean) => {
    (global as any).___getResponse = (filterFct: any, resultFct: any, triggerFct: any, closeFct: any = triggerFct) => Promise.race([new Promise((resolve) => {
      const originalRequestOpen = XMLHttpRequest.prototype.open;
      XMLHttpRequest.prototype.open = function (method: string, url: string, ...args: any[]) {
        if (filterFct(url, method)) {
          this.addEventListener('load', function () {
            try { resolve(resultFct(this.response, url, method)); } catch (error) { resolve(null); }
          });
        }
        originalRequestOpen.apply(this, [method, url, ...args] as any);
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

export async function randomClick(context: any, selectors: string[]): Promise<void> {
  if (!Array.isArray(selectors)) {
    console.log(`Invalid params passed, should receive an \`array\` instead received \`${typeof selectors}\``);
  }
  if (selectors.length === 0) { console.log('array is empty'); }
  console.log('executing random click...');
  const randomSelector = Math.floor(Math.random() * selectors.length);
  ifThereClickOnIt(context, selectors[randomSelector]);
}

export async function appendScreenCaptures(context: any, inputs: any, YAML: any, schemaYAML: string): Promise<void> {
  const oldLog = console.log;
  console.log = () => {};
  const yamlJSON = Object.values(YAML).find((el: any) => el.key === schemaYAML) as any;
  const fields = yamlJSON.fields.filter((field: any) => field.screenCapture);
  const obj: Record<string, any> = {};
  for (let index = 0; index < fields.length; index += 1) {
    const { name, screenCapture, downloadContent } = fields[index];
    if (typeof extractorContext !== 'undefined') {
      oldLog('Taking screenshot');
      const screenShot = await context.screenshot({ type: screenCapture, fullPage: null });
      oldLog(downloadContent);
      if (downloadContent === true || `${downloadContent}`.toLowerCase() === 'true') {
        const uuid = Date.now().toString(36) + Math.random().toString(36).slice(2);
        const fileName = `${name}${uuid}`;
        oldLog('unique filename:', `${fileName}.${screenCapture}`);
        const { body, url, ...rest } = await extractorContext.downloadURL(screenShot, `${fileName}.${screenCapture}`);
        obj[name] = [{ text: url, ...fields[index], url, ...rest }];
        obj[`${name}_fileName`] = [{ text: `${fileName}.${screenCapture}`, ...fields[index] }];
      } else {
        obj[name] = [{ text: screenShot, ...fields[index] }];
      }
    } else {
      oldLog('Screenshots are disabled on local or remote runs');
    }
  }
  console.log = oldLog;
  inputs.injectable = { ...inputs.injectable, ...obj };
}

export async function addAttributeToExtractedRecords(context: any, attrParam: any, YAML: any): Promise<void> {
  const attribute = attrParam === true || attrParam === 'true' || !attrParam ? '__extracted=true' : attrParam;
  const oldLog = console.log;
  console.log = () => {};
  const rawData = await context.data();
  const confiPath = rawData.slice(-1)[0].extractionConfig;
  const yamlJSON = YAML[confiPath];
  if (yamlJSON.regionsSelector) oldLog('++++++++++++++++++ regionsSelector is not supported for adding attribute to extracted records');
  if (yamlJSON.recordSelector || yamlJSON.recordXPath) {
    await addAttributeToMatches(context, { css: yamlJSON.recordSelector, xpath: yamlJSON.recordXPath, attribute });
  } else {
    const allCollectedXpaths = getAllXPaths(rawData);
    for (let index = 0; index < allCollectedXpaths.length; index += 1) {
      const [[xpathDoc, xpaths]] = Object.entries(allCollectedXpaths[index]);
      for (let pathIndex = 0; pathIndex < (xpaths as any[]).length; pathIndex += 1) {
        await addAttributeToMatches(context, { xpath: (xpaths as any[])[pathIndex], xpathDoc, attribute });
      }
    }
  }
  console.log = oldLog;
}

export function getAllXPaths(rawData: any[]): any[] {
  return rawData.flatMap(({ data }) => data?.flatMap(({ group, xpath: grpXpath }: any) => ({
    [grpXpath]: group?.flatMap((row: any) => Object.entries(row)
      .flatMap(([, values]) => values)
      .flatMap(({ xpath }: any) => xpath)),
  })));
}

export async function dropDownValue(context: any, CSSSelector: string, optionSubstring: string): Promise<void> {
  if (!await checkSelector(context, CSSSelector, 'CSS')) return;
  await context.evaluate((selector: string, valueText: string) => {
    const dropdown = document.querySelector(selector) as HTMLSelectElement;
    const desiredValue = (Array.from(dropdown.options) as HTMLOptionElement[]).find(({ text }) => text.includes(valueText));
    if (!desiredValue) { console.log(`Option containing '${valueText}' not found`); return false; }
    console.log(`Option containing '${valueText}' was found: ${desiredValue}`);
    dropdown.value = desiredValue.value;
    const event = new Event('change', { bubbles: true });
    dropdown.dispatchEvent(event);
    return true;
  }, CSSSelector, optionSubstring);
}

