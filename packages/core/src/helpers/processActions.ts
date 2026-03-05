/* eslint-disable no-await-in-loop */
/**
 * @param {{ selectorOrXpath: string, inputValue: string, wait: number}[]} inputs
 * @param { Record<string, any> } parameters
 * @param { ImportIO.IContext } context
 * @param { Record<string, any> } dependencies
 */

// When provided with an array of actions (selectorOrXpath, inputValue, wait) will execute them in order

interface Action {
  selectorOrXpath?: string;
  attributeToSet?: string | null;
  inputValue?: string | null;
  wait?: number;
  scrollFromSelectorOrXpath?: string | null;
  stopXPath?: string | null;
  doNotScrollXpath?: string;
  steps?: number;
  selectorOrXpathToWaitFor?: string;
  captchaCheck?: boolean;
  waitDisappear?: boolean;
  reloadPageAfterWait?: boolean;
}

interface ProcessActionsInputs {
  inputs: Record<string, any>;
  actions: Action[];
}

interface ProcessActionsDependencies {
  helperModule: { Helpers: new (context: any) => any };
  xpathElemToCSS: (opts: { wait?: number; selectorToCheck: string }) => Promise<string | false>;
  interpolate: (opts: { inputs: Record<string, any>; stringToInterpolate: string }) => Promise<string>;
  solveCaptcha: (opts: { inputs: Record<string, any>; options: Record<string, any> }) => Promise<void>;
}

export const dependencies = {
  helperModule: 'module:helpers/helpers',
  xpathElemToCSS: 'action:helpers/xpathToCSS',
  interpolate: 'action:helpers/inputInterpolation',
  solveCaptcha: 'action:captchas/solveCaptchas',
};

export const implementation = async (
  { inputs, actions }: ProcessActionsInputs,
  parameters: Record<string, any>,
  context: Record<string, any>,
  dependencies: ProcessActionsDependencies,
): Promise<boolean> => {
  if (!actions || !Array.isArray(actions) || !actions.length) return false;
  const validActions = actions.filter((act: Action | null | undefined) => act) as Action[];
  if (!validActions.length) return false;

  const { helperModule: { Helpers }, xpathElemToCSS, interpolate, solveCaptcha } = dependencies;
  const helper = new Helpers(context);
  for (let index = 0; index < validActions.length; index += 1) {
    const {
      selectorOrXpath = validActions[index] as unknown as string,
      attributeToSet = null, inputValue = null,
      wait = 0, scrollFromSelectorOrXpath = null, stopXPath = null, doNotScrollXpath, steps,
      selectorOrXpathToWaitFor = '', captchaCheck = false, waitDisappear = false,
      reloadPageAfterWait = false,
    } = validActions[index];
    try {
      const selector = await xpathElemToCSS({ wait, selectorToCheck: await interpolate({ inputs, stringToInterpolate: selectorOrXpath as string }) });
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
        if (reloadPageAfterWait) {
          await helper.reload(5000);
        }
      }
    } catch (error) {
      console.error(error);
    }
    if (captchaCheck) {
      await solveCaptcha({ inputs, options: { ...inputs.newGoto2, timeout: wait } });
    }
    if (waitDisappear) {
      const selector = await xpathElemToCSS({ selectorToCheck: await interpolate({ inputs, stringToInterpolate: selectorOrXpath as string }) });
      const maxLoopIter = 3;
      let indexLoop = 0;
      while (await helper.checkCSSSelector(selector) && indexLoop < maxLoopIter) {
        await new Promise(resolve => setTimeout(resolve, wait));
        indexLoop += 1;
      }
    }
  }
  return true;
};
