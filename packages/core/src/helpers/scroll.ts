import { optionalWait } from './wait.ts';
import { checkSelector, checkAndSetProp } from './dom.ts';

export async function scrollIntoView(context: any, elementSelectorCSS: string): Promise<void> {
  return context.evaluate((selectorCSS: string) => {
    const element = document.querySelector(selectorCSS);
    if (element) element.scrollIntoView({ behavior: 'smooth' });
  }, elementSelectorCSS);
}

export async function scrollBy(context: any, elementSelectorCSS: string, coefficient: number = 1): Promise<void> {
  return context.evaluate((selectorCSS: string, coef: number) => {
    document.querySelector(selectorCSS)!.scrollBy(0, document.querySelector(selectorCSS)!.scrollHeight * coef);
  }, elementSelectorCSS, coefficient);
}

export async function scrollToElementUntil(
  context: any,
  elementSelectorCSS: string,
  stopXPath: string | null,
  options: any,
  stopCSS: string | null = null,
): Promise<void> {
  const elementExists = (await optionalWait(context, elementSelectorCSS, 3000)) !== false;
  if (!elementExists) return;
  const { timeout = Number(options) ? options : 500, waitTime = 500 } = options || {};
  let loopCounter = 0;
  let isStop = false;
  const limit = Math.ceil(timeout / waitTime);
  while (loopCounter < limit && !isStop) {
    loopCounter += 1;
    await scrollIntoView(context, elementSelectorCSS);
    await new Promise(resolve => setTimeout(resolve, waitTime));
    if (stopXPath || stopCSS) isStop = await checkSelector(context, stopXPath || stopCSS, stopXPath ? 'XPath' : 'CSS');
  }
}

export async function getAllScrollablesBetweenElems(
  context: any,
  topElementCSS: string,
  targetElementCSS: string,
  doNotScrollXpath: string | null,
): Promise<() => Promise<{ numberElements: number; selectify: (idx: number) => string }>> {
  let iter = -1;
  const attr = '__scrollid';
  await checkAndSetProp(context, topElementCSS, '1', 'CSS', 'topElementID');
  await checkAndSetProp(context, targetElementCSS, '1', 'CSS', 'targetElementID');
  const rootXPATH = `//body//*[@topElementID="1"]//*[not(local-name()="script")][not(local-name()="a")][not(.//*)][not(@${attr})][not(./ancestor::*[local-name()="svg"])][not(@aria-hidden="true")][not(./preceding-sibling::*[@targetElementID="1"])][not(./preceding-sibling::*//*[@targetElementID="1"])]`;
  return async () => {
    iter += 1;
    const numberElements = await context.evaluate((selector: string, iter: number, nopeSelector: string | null, attr: string) => {
      const getXPathArray = (pth: string, doc: Document = document) => {
        const results = document.evaluate(pth, doc || document, null, XPathResult.ORDERED_NODE_ITERATOR_TYPE);
        const nodesArray: Element[] = [];
        let node = results.iterateNext();
        while (node) {
          if (node.nodeType === 1) nodesArray.push(node as Element);
          if (node.nodeType === 2) nodesArray.push((node as Attr).ownerElement!);
          if (node.nodeType === 3) nodesArray.push((node as Text).parentElement!);
          node = results.iterateNext();
        }
        return nodesArray;
      };
      const nopeArr = nopeSelector ? getXPathArray(nopeSelector) : [];
      const nodeArr = getXPathArray(selector)
        .filter(elem => ((elem as HTMLElement).offsetHeight && elem.getClientRects().length && !nopeArr.includes(elem)));
      const total = nodeArr.length - 1;
      nodeArr.forEach((el, idx) => el.setAttribute(attr, `${idx}/${total} - iter:${iter}`));
      return total;
    }, rootXPATH, iter, doNotScrollXpath, attr);
    return { numberElements, selectify: (idx: number) => `[${attr}='${idx}/${numberElements} - iter:${iter}']` };
  };
}

export async function scrollTarget(
  context: any,
  topElementCSS: string,
  targetElementCSS: string,
  stopXPath: string | null,
  doNotScrollXpath: string | null,
  { waitTime = 10, steps = 50 }: { waitTime?: number; steps?: number } = {},
): Promise<void> {
  const setItems = await getAllScrollablesBetweenElems(context, topElementCSS, targetElementCSS, doNotScrollXpath);
  let round = await setItems();
  let index = 0;
  while (round.numberElements > 0) {
    if (stopXPath && await checkSelector(context, stopXPath, 'XPath')) break;
    await scrollToElementUntil(context, round.selectify(index), null, { timeout: waitTime, waitTime });
    index += steps;
    if (index >= round.numberElements) {
      await scrollToElementUntil(context, round.selectify(round.numberElements), null, { timeout: waitTime, waitTime });
      index = 0;
      round = await setItems();
    }
  }
}

