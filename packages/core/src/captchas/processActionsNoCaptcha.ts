/* eslint-disable no-await-in-loop */
/**
* @param {{ selectorOrXpath: string, inputValue: string, wait: number}[]} inputs
* @param { Record<string, any> } parameters
* @param { ImportIO.IContext } context
* @param { Record<string, any> } dependencies
*/

// When provided with an array of actions (selectorOrXpath, inputValue, wait) will execute them in order

module.exports = {
  dependencies: { helperModule: 'module:helpers/helpers', xpathElemToCSS: 'action:helpers/xpathToCSS', interpolate: 'action:helpers/inputInterpolation' },
  implementation: async ({ inputs, actions }, parameters, context, dependencies) => {
    if (!actions || !Array.isArray(actions)) return false;

    const { helperModule: { Helpers }, xpathElemToCSS, interpolate } = dependencies;
    const helper = new Helpers(context);
    for (let index = 0; index < actions.length; index += 1) {
      const {
        selectorOrXpath = actions[index],
        attributeToSet = null, inputValue = null,
        wait = 0, scrollFromSelectorOrXpath = null, stopXPath = null, doNotScrollXpath, steps,
        selectorOrXpathToWaitFor = '', waitDisappear = false,
      } = actions[index];
      try {
        const selector = await xpathElemToCSS({ selectorToCheck: await interpolate({ inputs, stringToInterpolate: selectorOrXpath }) });
        const value = inputValue ? await interpolate({ inputs, stringToInterpolate: inputValue }) : '';
        if (scrollFromSelectorOrXpath) {
          const scrollFrom = await xpathElemToCSS({ selectorToCheck: await interpolate({ inputs, stringToInterpolate: scrollFromSelectorOrXpath }) });
          await helper.scrollTarget(scrollFrom, selector, stopXPath, doNotScrollXpath, { waitTime: wait, steps });
        } else {
          await helper[attributeToSet ? 'checkAndSetProp' : 'checkAndClick'](selector, value, 'CSS', attributeToSet);
        }
        if (selectorOrXpathToWaitFor) {
          const isValidCSS = await helper.isValidCSS(selectorOrXpathToWaitFor);
          await helper.optionalWait(selectorOrXpathToWaitFor, wait, isValidCSS ? 'CSS' : 'XPATH');
        } else if (wait) {
          await new Promise(resolve => setTimeout(resolve, wait));
        }
      } catch (error) {
        console.error(error);
      }
      if (waitDisappear) {
        const selector = await xpathElemToCSS({ selectorToCheck: await interpolate({ inputs, stringToInterpolate: selectorOrXpath }) });
        const maxLoopIter = 3;
        let indexLoop = 0;
        while (await helper.checkCSSSelector(selector) && indexLoop < maxLoopIter) {
          await new Promise(resolve => setTimeout(resolve, wait));
          indexLoop += 1;
        }
      }
    }
    return true;
  },
};
