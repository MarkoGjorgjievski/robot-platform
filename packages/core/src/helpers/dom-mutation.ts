import { optionalWait } from './wait.ts';

export async function addItemToDocument(
  context: any,
  key: string,
  value: string,
  { parentSelector = '', type = 'div', htmlString = '' } = {},
): Promise<void> {
  const inputs = { key, value, parentSelector, type, htmlString };
  const oldLog = console.log;
  console.log = () => {};
  await context.evaluate((inputs: any) => {
    const addItemToDocument = ({ key: id, value, parentSelector, type, htmlString }: any) => {
      const htmlToAdd = `<${type} id="${id}"${htmlString}></${type}>`;
      const root = parentSelector ? document.querySelector(parentSelector) : document.body;
      root.insertAdjacentHTML('beforeend', htmlToAdd);
      document.querySelector(`#${id}`).innerHTML = value;
      document.querySelector(`#${id}`).textContent = document.querySelector(`#${id}`)?.innerText;
    };
    addItemToDocument(inputs);
  }, inputs);
  console.log = oldLog;
}

export async function addArrayToDocument(
  context: any,
  key: string,
  values: string[],
  { parentID = '', type = 'div', clss = '' } = {},
): Promise<void> {
  const inputs = { key, values, parentID, type, clss };
  await context.evaluate((inputs: any) => {
    const addArrayToDocument = ({ key: id, values, parentID, type, clss }: any) => {
      const classStr = clss ? ` class="${clss}" ` : '';
      const htmlString = `<${type} id="${id}"${classStr}></${type}>`;
      const root = parentID ? document.querySelector(parentID) : document.body;
      root.insertAdjacentHTML('beforeend', htmlString);
      if (Array.isArray(values)) {
        const liStr = values.reduce((acc: string, val: string) => `${acc}<li>${val}</li>`, '<ul>');
        const innerHTML = `${liStr}</ul>`;
        document.querySelector(`#${id}`).innerHTML = innerHTML;
      } else {
        throw new Error('The provided values are not an array.');
      }
    };
    addArrayToDocument(inputs);
  }, inputs);
}

export async function addJSONURLtoDocument(
  context: any,
  key: string,
  lastPartOnly: boolean,
): Promise<void> {
  const url: string = await context.evaluate(() => window.location.href);
  const urlParts = url ? url.split('/') : [];
  if (lastPartOnly) return await addItemToDocument(context, key, urlParts[urlParts.length - 1]);
  return await addItemToDocument(context, key, url);
}

export async function addURLtoDocument(
  context: any,
  { depth, currentIndex }: { depth?: number; currentIndex?: number },
): Promise<void> {
  const url: string = await context.evaluate(() => window.location.href);
  const uuid = Date.now().toString(36) + Math.random().toString(36).slice(2);
  return await addItemToDocument(context, `addedURLToDocument_${uuid}`, '', { parentSelector: 'html > head', type: 'link', htmlString: `href="${url}" depth="${depth || 0} iter="${currentIndex || 0}"` });
}

export async function removeScriptsWhichContains(
  context: any,
  text: string,
): Promise<void> {
  return context.evaluate((text: string) => {
    [...document.querySelectorAll('script')]
      .map(node => ({ node, textContent: node.textContent, src: (node as HTMLScriptElement).src }))
      .filter(({ textContent, src }) => textContent.includes(text) || src.includes(text))
      .forEach(({ node }) => node.remove());
  }, text);
}

export async function moveShadowToMainDom(
  context: any,
  shadowRootCSSSelector: string,
  index: number,
): Promise<boolean> {
  if (await optionalWait(context, shadowRootCSSSelector, 5000) === false) return false;
  await context.evaluate(({ selector, ind }: { selector: string; ind: number }) => {
    const id = `shadow-${ind}`;
    document.body.insertAdjacentHTML('beforeend', `<div id="${id}"></$div>`);
    const shadowElem = document.querySelector(selector)?.shadowRoot;
    document.querySelector(`#${id}`).innerHTML = shadowElem?.innerHTML;
  }, { selector: shadowRootCSSSelector, ind: index });
  return true;
}

export async function deleteDuplicateDOMElements(
  context: any,
  selectors: string[],
): Promise<void> {
  await context.evaluate(async (passedSels: string[]) => {
    passedSels.forEach((selector) => {
      const elements = document.querySelectorAll(selector) || [];
      elements.forEach((element, index) => {
        if (index > 0) element.remove();
      });
    });
  }, selectors);
}

