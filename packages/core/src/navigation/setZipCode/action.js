/* eslint-disable no-await-in-loop */
/**
* @param {{ zipcod: string, config: object }} inputs
* @param { Record<string, any> } parameters
* @param { ImportIO.IContext } context
* @param { Record<string, any> } dependencies
*/

// When provided a zipcode and a configuration object, will set the zipcode on the page

module.exports = {
  dependencies: { xpathElemToCSS: 'action:helpers/xpathToCSS', processActions: 'action:helpers/processActions', helperModule: 'module:helpers/helpers' },
  implementation: async (inputs, parameters, context, dependencies) => {
    const { zipcode, setZipCode } = inputs;
    const { xpathElemToCSS, processActions, helperModule: { Helpers } } = dependencies;
    const helper = new Helpers(context);

    if (setZipCode == null || !Object.keys(setZipCode).length) return false;

    const {
      checkZipCodeSelectorOrXPath, maxTries = 1, setZipWithUI:
        { inputSelectorOrXPath = '', beforeInputSelectorOrXpathArray = [], afterInputSelectorOrXPathArray = [], wait = 3000 } = {},
    } = setZipCode;

    if ((!checkZipCodeSelectorOrXPath && !zipcode && !inputSelectorOrXPath) || !maxTries) return false; // case where only default values are present

    if (!checkZipCodeSelectorOrXPath || !zipcode || !inputSelectorOrXPath) {
      throw new Error(`Setzipcode was called without checkZipCodeSelectorOrXPath: ${checkZipCodeSelectorOrXPath}, without inputSelectorOrXPath: ${inputSelectorOrXPath}, or without zipcode: ${zipcode}`);
    }

    let zipTries = 0;
    let isSet = false;

    const isZipCodeSet = async () => {
      const checkZipCodeCSS = await xpathElemToCSS({ selectorToCheck: checkZipCodeSelectorOrXPath });
      if (!checkZipCodeCSS) throw new Error(`Failed to generate a valid CSS selector from ${checkZipCodeSelectorOrXPath}, try to directly provide a CSS selector instead}`);
      const zipText = await helper.checkAndReturnProp(checkZipCodeCSS, 'CSS', 'textContent');
      isSet = zipText?.toLowerCase()?.includes(zipcode.toLowerCase());
      console.log(`Currently the zipcode is ${isSet ? '' : 'not '}set to ${zipcode}`);
      return isSet;
    };

    const setZipUsingUI = async () => {
      const selToAction = sel => ({ selectorOrXpath: sel, inputValue: null, wait: null });
      const actions = [
        ...(beforeInputSelectorOrXpathArray || []).map(selToAction),
        { selectorOrXpath: inputSelectorOrXPath, inputValue: zipcode, wait: 2000 },
        ...(afterInputSelectorOrXPathArray || []).map(selToAction),
      ];
      if (actions.length > 2) actions[actions.length - 1].wait = wait;// let the page reload automatically
      await processActions({ inputs, actions });
      return isZipCodeSet();
    };

    if (await isZipCodeSet()) {
      console.log(`Zipcode ${zipcode} is already set`);
      return true;
    }

    while (zipcode !== null && zipTries < maxTries) {
      zipTries += 1;
      console.log(`Attempt #${zipTries} out of ${maxTries} to set the zipcode to ${zipcode}`);
      if (await setZipUsingUI()) return true;
    }
    console.log(`The zipcode ${isSet ? 'did' : 'failed to'} set to ${zipcode}`);
    return false;
  },
};
