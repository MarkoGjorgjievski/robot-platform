import { optionalWait } from './wait.ts';

export async function isValidCSS(context: any, selectorToCheck: string): Promise<string | false> {
  if (!selectorToCheck) return false;
  const oldLog = console.log;
  console.log = () => {};
  const isValid = await context.evaluate((selector: string) => {
    try { document.createDocumentFragment().querySelector(selector); return true; } catch (e) { return false; }
  }, selectorToCheck);
  console.log = oldLog;
  if (isValid) return selectorToCheck;
  return false;
}

export async function isValidXpath(context: any, selectorToCheck: string): Promise<string | false> {
  if (!selectorToCheck) return false;
  const oldLog = console.log;
  console.log = () => {};
  const isValid = await context.evaluate((selector: string) => {
    try { document.evaluate(selector, document, null, XPathResult.ANY_TYPE, null); return true; } catch (e) { return false; }
  }, selectorToCheck);
  console.log = oldLog;
  if (isValid) return selectorToCheck;
  return false;
}

export async function checkCSSSelector(context: any, selector: string): Promise<boolean> {
  return await context.evaluate((selector: string) => {
    const elem = document.querySelector(selector);
    return !!elem;
  }, selector);
}

export async function checkXpathSelector(context: any, selector: string): Promise<boolean> {
  return await context.evaluate((selector: string) => {
    const elem = document.evaluate(selector, document, null, XPathResult.ANY_UNORDERED_NODE_TYPE, null);
    return elem ? !!elem.singleNodeValue : false;
  }, selector);
}

export async function checkURLFor(context: any, substring: string): Promise<boolean> {
  const url = context.evaluate(() => window.location.href);
  return url.includes(substring);
}

export async function checkAndClick(context: any, selector: string, input: any, type: string = 'CSS'): Promise<void> {
  if (!await checkSelector(context, selector, type)) return;
  // Lazy import to break circular dependency (dom -> misc -> dom)
  const { ifThereClickOnIt } = await import('./misc.ts');
  await Promise.all([
    !input ? await ifThereClickOnIt(context, selector) : await context.setInputValue(selector, input).catch(),
  ]).catch();
}

export async function checkSelector(context: any, selector: string, type: string = 'css'): Promise<boolean> {
  if (selector === '') return false;
  let elemIsThere;
  if (type.toLowerCase() === 'xpath') elemIsThere = await checkXpathSelector(context, selector);
  else if (type.toLowerCase() === 'css') elemIsThere = await checkCSSSelector(context, selector);
  else return false;
  return elemIsThere;
}

export async function checkAndReturnProp(context: any, selector: string, type: string, property: string): Promise<any> {
  if (!await checkSelector(context, selector, type)) return null;
  return await context.evaluate(({ selector, property, type }: { selector: string; property: string; type: string }) => {
    let elem: any;
    if (type.toLowerCase() === 'xpath') elem = document.evaluate(selector, document, null, XPathResult.ANY_UNORDERED_NODE_TYPE, null).singleNodeValue;
    else if (type.toLowerCase() === 'css') elem = document.querySelector(selector);
    return elem[property] || (elem?.getAttribute ? elem?.getAttribute(property) : null);
  }, { selector, property, type });
}

export async function checkAndSetProp(context: any, selector: string, value: string, type: string, property: string): Promise<any> {
  if (!await checkSelector(context, selector, type)) return null;
  return await context.evaluate(({ selector, property, type, value }: { selector: string; property: string; type: string; value: string }) => {
    let elem: any;
    if (type.toLowerCase() === 'xpath') elem = document.evaluate(selector, document, null, XPathResult.ANY_UNORDERED_NODE_TYPE, null).singleNodeValue;
    else if (type.toLowerCase() === 'css') elem = document.querySelector(selector);
    elem?.setAttribute(property, value);
    return elem?.[property];
  }, { selector, property, type, value });
}

export async function addAttributeToMatches(context: any, { xpath, css = '', xpathDoc = '', attribute }: { xpath?: string; css?: string; xpathDoc?: string; attribute: string }): Promise<void> {
  if (css) {
    await context.evaluate(({ sel, attribute: str }: { sel: string; attribute: string }) => {
      [...document.querySelectorAll(sel)].forEach(el => el.setAttribute(str.split('=')[0], str.split('=')[1]));
    }, { css, attribute })
      .catch((err: any) => console.log(`Adding extracted attribute to elems matching css: ${css} failed with ${err}`));
  }
  if (xpath) {
    await context.evaluate(({ xpath, xpathDoc, attribute: str }: { xpath: string; xpathDoc: string; attribute: string }) => {
      const getXPathArray = (pth: string, doc: any) => {
        const results = document.evaluate(pth, doc || document, null, XPathResult.ORDERED_NODE_ITERATOR_TYPE);
        const nodesArray: any[] = [];
        let node = results.iterateNext();
        while (node) {
          if (node.nodeType === 1) nodesArray.push(node);
          if (node.nodeType === 2) nodesArray.push((node as Attr).ownerElement);
          if (node.nodeType === 3) nodesArray.push((node as Text).parentElement);
          node = results.iterateNext();
        }
        return nodesArray;
      };
      const root = xpathDoc ? getXPathArray(xpathDoc, undefined)[0] : document;
      getXPathArray(xpath, root).forEach(el => el.setAttribute(str.split('=')[0], str.split('=')[1]));
    }, { xpath, xpathDoc, attribute })
      .catch((err: any) => console.log(`Adding extracted attribute to elems matching xpath: ${xpath} failed with ${err}`));
  }
}

export async function waitAndCount(context: any, selector: string, timeout: number): Promise<number> {
  await optionalWait(context, selector, timeout);
  if (!await checkSelector(context, selector, 'CSS')) return 0;
  return await context.evaluate(({ selector }: { selector: string }) => {
    const elems = document.querySelectorAll(selector);
    return elems.length;
  }, { selector });
}

