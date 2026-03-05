import { checkSelector } from './dom.ts';

export async function optionalWait(context: any, selector: string, timeout: number, type: string = 'CSS'): Promise<boolean> {
  if (!selector) return false;
  const hardcodedLimit = 30000;
  let remaining = parseInt(String(timeout), 10);
  const fct = type.toLowerCase() === 'css' ? 'waitForSelector' : 'waitForXPath';
  while (remaining > 0) {
    const waitTime = Math.min(hardcodedLimit, remaining);
    try {
      await context[fct](selector, { timeout: waitTime });
      console.log(`The following selector was found: ${selector} within timeout: ${timeout}`);
      return true;
    } catch (error) {
      remaining -= waitTime;
    }
  }
  console.log(`The following selector was not found: ${selector} after timeout: ${timeout}`);
  return false;
}

export async function waitToDisappear(context: any, selector: string, options: any): Promise<void> {
  const { timeout = Number(options) ? options : 500 } = options || {};
  let loopCounter = 0;
  let isThere = false;
  const waitingTime = 500;
  const limit = Math.ceil(timeout / waitingTime);
  while (loopCounter < limit && !isThere) {
    loopCounter += 1;
    isThere = await checkSelector(context, selector, 'CSS');
    await new Promise(resolve => setTimeout(resolve, waitingTime));
  }
}

export async function waitForInDifferentContext(context: any, selector: string, documentSelector: string, options: any): Promise<boolean> {
  const { timeout = Number(options) ? options : 500 } = options || {};
  console.log('..waitForLoader..:', documentSelector);
  const waitingTime = 500;
  const limit = Math.ceil(timeout / waitingTime);
  await optionalWait(context, documentSelector, timeout);
  const rootIsThere = await context.evaluate((docSel: string) => {
    const docOrIframe = document.querySelector(docSel);
    const doc = (docOrIframe as any)?.contentDocument || (docOrIframe as any)?.shadowRoot || docOrIframe;
    console.log('=====================');
    console.log(`the document context node is iframe ${!!(docOrIframe as any)?.contentDocument}, shadowRoot: ${!!(docOrIframe as any)?.shadowRoot}, elem: ${!!docOrIframe}`);
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
    isThere = await context.evaluate(([sel, docSel]: [string, string]) => {
      const docOrIframe = document.querySelector(docSel);
      const doc = (docOrIframe as any)?.contentDocument || (docOrIframe as any)?.shadowRoot || docOrIframe;
      console.log(`Checking if the following selector is there: ${sel}`);
      return !!doc?.querySelector(sel);
    }, [selector, documentSelector]);
    await new Promise(resolve => setTimeout(resolve, waitingTime));
  }
  console.log(`The wait for selector ${selector} within context ${documentSelector} returned ${isThere}`);
  return isThere;
}

export async function waitForFrameToLoad(context: any, selector: string, options: any): Promise<boolean> {
  if (selector === '') return false;
  const { timeout = Number(options) ? options : 500, selectorType: type = 'css' } = options || {};
  if (!await checkSelector(context, selector, type)) return false;
  const waitingTime = 500;
  const limit = Math.ceil(timeout / waitingTime);
  let loopCounter = 0;
  let isLoaded = false;
  while (loopCounter < limit && !isLoaded) {
    loopCounter += 1;
    isLoaded = await context.evaluate((sel: string) => {
      const docOrIframe = document.querySelector(sel);
      if (!docOrIframe) return false;
      const doc = (docOrIframe as any).contentDocument || docOrIframe;
      return doc.readyState === 'complete';
    }, selector);
    console.log(`Checking if the following frame selector is loaded: ${selector}, -> ${isLoaded}`);
    await new Promise(resolve => setTimeout(resolve, waitingTime));
  }
  return isLoaded;
}

