/**
* @param {{ selector: string }} inputs
* @param { Record<string, any> } parameters
* @param { ImportIO.IContext } context
* @param { Record<string, any> } dependencies
*/

// When provided with an XPATHorCSS string
// this function returns a truthy value which is a valid CSS selector or returns false
// (if the input string isn't a valid xpath selector or is but isn't a valid node)

interface XpathToCSSInputs {
  selectorToCheck: string;
  wait?: number;
}

interface XpathToCSSDependencies {
  helperModule: { Helpers: new (context: any) => any };
}

export const dependencies = { helperModule: 'module:helpers/helpers' };

export const implementation = async (
  { selectorToCheck, wait }: XpathToCSSInputs,
  parameters: Record<string, any>,
  context: Record<string, any>,
  dependencies: XpathToCSSDependencies,
): Promise<string | false> => {
  const { helperModule: { Helpers } } = dependencies;
  const helper = new Helpers(context);
  if (!selectorToCheck) return false; // allow passthrough of empty values to a false value

  const isValidCSS = await helper.isValidCSS(selectorToCheck);

  if (isValidCSS) return selectorToCheck;

  const isValidXpath = await helper.isValidXpath(selectorToCheck);

  // disable logs
  const oldLog = console.log;
  console.log = () => {};

  if (isValidXpath) {
    await helper.optionalWait(selectorToCheck, wait, 'XPATH');
    // generate a valid css if possible
    // add a unique ID to the elem so it can be targeted by css
    const resultCSS = await context.evaluate((selector: string) => {
      const uuid = Date.now().toString(36) + Math.random().toString(36).slice(2);
      const attributename = 'xpathId';
      const CSSSelector = `[${attributename}="${uuid}"]`;
      const elem = document.evaluate(selector, document, null, XPathResult.ANY_UNORDERED_NODE_TYPE, null);
      if (elem?.singleNodeValue?.nodeType === 1) { // check the node type is ELEMENT_NODE
        // @ts-ignore
        elem.singleNodeValue.setAttribute(attributename, uuid);
        return CSSSelector;
      }
      if (elem?.singleNodeValue?.nodeType === 2) { // check the node type is ATTRIBUTE_NODE
        // @ts-ignore
        document.body.appendChild(Object.assign(document.createElement('div'), { textContent: elem.singleNodeValue?.nodeValue })).setAttribute(attributename, uuid);
        return CSSSelector;
      }
      if (elem?.singleNodeValue?.nodeType === 4) { // check the node type is CDATA_SECTION_NODE
        // @ts-ignore
        document.body.appendChild(Object.assign(document.createElement('div'), { textContent: (elem as any).iterateNext()?.value })).setAttribute(attributename, uuid);
        return CSSSelector;
      }
      if (elem?.singleNodeValue?.nodeType) {
        console.log(selector, elem, elem?.singleNodeValue, elem?.singleNodeValue?.nodeType);
        throw new Error(`nodeType: ${elem?.singleNodeValue?.nodeType} is not implemented yet`);
      }
      console.log(selector, elem, elem?.singleNodeValue, elem?.singleNodeValue?.nodeType);
      console.log('The xpath provided is a valid xpath but isn\'t present on the page.');
      return '[xpathNotPresentOnPage]';
    }, selectorToCheck);
    console.log = oldLog;
    console.log(`The xpath provided was turned into: ${resultCSS}, ${selectorToCheck}`);
    return resultCSS;
  }
  console.log = oldLog;
  console.log(`Something went wrong while transforming ${selectorToCheck} into a css selector.`);
  return false;
};
