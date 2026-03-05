/* eslint-disable no-console */
/**
* @param {{ selector: string }} inputs
* @param { Record<string, any> } parameters
* @param { ImportIO.IContext } context
* @param { Record<string, any> } dependencies
*/
// appends extra info on the page in a way that can be recovered by the extract.yaml

interface AppendEntry {
  document?: string;
  window?: string;
  xpath?: string;
  css?: string;
  regex?: string;
  JSONpath?: string;
  splitJSON?: boolean;
  doNotParse?: boolean;
  forceAdditionalParsing?: boolean;
  input?: string;
}

interface AppendInputs {
  append?: Record<string, AppendEntry>;
  appendCookies?: boolean;
  [key: string]: any;
}

interface AppendDependencies {
  xpathElemToCSS: (opts: { selectorToCheck: string }) => Promise<string | false>;
}

interface AppendContext {
  saveJson: (key: string, value: any) => Promise<any>;
  cookies: () => Promise<any>;
  evaluate: (fn: Function | string, ...args: any[]) => Promise<any>;
}

export const dependencies = { xpathElemToCSS: 'action:helpers/xpathToCSS' };

export const implementation = async (
  inputs: AppendInputs,
  parameters: Record<string, any>,
  context: AppendContext,
  { xpathElemToCSS }: AppendDependencies,
): Promise<any> => {
  const { append, appendCookies } = inputs;
  if (appendCookies) await context.saveJson('added_cookies', await context.cookies());
  if (!append) return false; // allow passthrough of empty values to a false value
  // eslint-disable-next-line no-return-await
  return await Promise.all(Object.entries(append).map(async ([key, {
    document: documentKey,
    window: windowKey, xpath, css, regex, JSONpath, splitJSON = false, doNotParse = false, forceAdditionalParsing = false,
    input: inputKey,
  }]: [string, AppendEntry]) => {
    console.log(`Currently appending: ${key}`);
    let txt: any;
    if (windowKey || documentKey) {
      const { log, trace } = console;
      console.log = () => {};
      console.trace = () => {};
      txt = await context.evaluate(({ windowKey: wK, documentKey: dK }: { windowKey?: string; documentKey?: string }) => {
        const pathArr = (wK || dK)!.replace(/^\./, '').replace(/\[(\d)\]/g, '.$1').split('.').filter((el: string) => el); // change path [nb] to .nb no support for path ."datalayer[4]"
        return pathArr.reduce((acc: any, path: string) => acc[path], !wK ? document : window);
      }, { windowKey, documentKey });
      console.log = log;
      console.trace = trace;
      console.log(`data read from ${documentKey ? 'document' : 'window'} udpated`, JSON.stringify(txt).slice(0, 100));
    } else if (xpath || css) {
      const selector = await xpathElemToCSS({ selectorToCheck: xpath || css as string });
      console.log(`The selector looked for is: "${selector}"`);
      if (!selector) {
        console.log(`The element corresponding to ${xpath || css} could not be found and wasn't appended`);
        return false;
      }
      // eslint-disable-next-line arrow-body-style
      txt = await context.evaluate((sel: string) => {
        return document.querySelector(sel)?.textContent;
      }, selector);
      if (regex) {
        console.log(`The regex: "${regex}" will be extracted`);
        try {
          txt = [...txt.matchAll(RegExp(regex, 'gm'))]?.[0]?.[1]; // return the first subgroup match of the first match
        } catch (error) {
          console.log(`========= ERROR ====== The regex ${regex} failed with error:`, error);
        }
      }
      if (txt == null) {
        console.log('Nothing was extracted');
        txt = {}; // default to a basic object
      } else {
        console.log(`The ${regex ? 'regex' : 'selector'} did extract something`);
      }
    } else if (inputKey) {
      const pathArr = inputKey.replace(/\[(\d)\]/g, '.$1').split('.'); // change path [nb] to .nb no support for path ."datalayer[4]"
      txt = pathArr.reduce((acc: any, path: string) => acc[path], inputs);
      console.log('data read from inputs udpated', txt);
    } else {
      throw new Error('No identifier or selector provided to the append function');
    }
    if (forceAdditionalParsing) txt = JSON.parse(txt);
    if (doNotParse) return context.saveJson(key, { raw: txt });
    let json: any;
    try {
      json = typeof txt === 'string' ? JSON.parse(txt) : txt;
    } catch {
      console.log(`Tried to append ${key} but failed the JSON parsing, change regex or change selector`);
      return false;
    }
    if (JSONpath) {
      // remove the leading . from JSONpath
      const pathArr = JSONpath.replace(/^\./, '').replace(/\[(\d)\]/g, '.$1').split('.'); // change path [nb] to .nb no support for path ."datalayer[4]"
      json = pathArr.reduce((acc: any, path: string) => acc?.[path], json) || {};
    }
    if (splitJSON) {
      const arr = Array.isArray(json) ? json : Object.entries(json).map(([kk, val]: [string, any]) => ({ key: kk, value: val }));
      // eslint-disable-next-line no-return-await
      return Promise.all(arr.map(async (arrElem: any, index: number) => await context.saveJson(`${key}_${index}`, arrElem)))
        .catch(console.log);
    }
    return context.saveJson(key, typeof json === 'object' ? json : { raw: json });
  }))
    .catch(console.log);
};
