/* eslint-disable no-await-in-loop */
/**
* @param {{ selectorOrXpath: string, inputValue: string, wait: number}[]} inputs
* @param { Record<string, any> } parameters
* @param { ImportIO.IContext } context
* @param { Record<string, any> } dependencies
*/

// When provided with an array of actions (selectorOrXpath, inputValue, wait) will execute them in order

module.exports = {
  dependencies: { helperModule: 'module:helpers/helpers', processActions: 'action:captchas/processActionsNoCaptcha' },
  implementation: async ({ inputs, options }, parameters, context, dependencies) => {
    const { helperModule: { Helpers }, processActions } = dependencies;
    const helper = new Helpers(context);
    const {
      captchaSelectors,
      hardBlockChecks,
      maxCaptcha,
      validPageSelector,
      isCaptchaInNestedIframe,
      submitCaptchaButtonCSS,
      timeout,
      sumbitCaptchaOrderedActions,
      timeoutOffset = 1000,
    } = options;
    let captchaCounter = 0;
    const captchas = Object.keys(captchaSelectors);
    const solvers = {
      RECAPTCHA: { key: 'grecaptcha', funct: 'execute' },
      GEETEST: { key: '_geetest', funct: '_solve' },
    };

    const isNotHardBlocked = async () => {
      for (let index = 0; index < captchas.length; index += 1) {
        const captcha = captchas[index];
        const captchaSelector = captchaSelectors[captcha].inputElement || captchaSelectors[captcha];
        // check if we are hadblocked
        const isHardBlocked = hardBlockChecks ? await helper.searchInFullPage(captchaSelector, hardBlockChecks) : false;
        if (isHardBlocked) {
          console.log('Blocked');
          await context.reportBlocked(700, 'Hard blocked');
          return false;
        }
      }
      return true;
    };

    const isThereACaptcha = async (captchaCount) => {
      const prophasBeenSeen = 'hasbeenseen';
      const waitTime = captchaCount ? timeout + timeoutOffset : timeout; // if it isn't the first time we add a static timeout offset
      // check if one of the captcha is there
      for (let index = 0; index < captchas.length; index += 1) {
        const captcha = captchas[index];
        const captchaSelector = captchaSelectors[captcha].imageElement || captchaSelectors[captcha].inputElement || captchaSelectors[captcha];
        // wait for the captchas to be there
        await helper.optionalWait(captchaSelector, waitTime);
        const isCaptchaFramePresent = await helper.checkSelector(captchaSelector, 'CSS');
        const hasbeenseen = await helper.checkAndReturnProp(captchaSelector, 'CSS', prophasBeenSeen);
        const isOnValidPage = validPageSelector ? await helper.checkSelector(validPageSelector, 'CSS') : false;
        const endtext = validPageSelector ? ` and the page is ${isOnValidPage ? '' : 'not '} a valid data page` : '';
        const hasbeenSeenText = hasbeenseen ? ', but has already been seen - it will be ignored' : '';
        console.log(`Captcha of type: ${captcha} is ${isCaptchaFramePresent ? '' : 'not '}present${hasbeenSeenText}${endtext}`);
        if (isCaptchaFramePresent && !hasbeenseen) {
          await helper.checkAndSetProp(captchaSelector, 'seen', 'CSS', prophasBeenSeen);
          return captcha;
        }
      }
      return '';
    };

    let captchaPresent;
    // eslint-disable-next-line no-cond-assign
    while ((captchaPresent = await isThereACaptcha(captchaCounter)) && captchaCounter < maxCaptcha && await isNotHardBlocked()) {
      const solver = solvers[captchaPresent]?.solver || captchaSelectors[captchaPresent]?.solver || context.solveCaptcha;
      captchaCounter += 1;
      if (isCaptchaInNestedIframe) {
        // @ts-ignore
        await context.evaluateInFrame('iframe', ({ key, funct }) => window[key][funct](), solvers[captchaPresent]);
      } else {
        let cpt = { type: captchaPresent, inputElement: 'iframe' };
        if (captchaSelectors[captchaPresent] === Object(captchaSelectors[captchaPresent])) {
          // @ts-ignore
          cpt = { ...cpt, ...captchaSelectors[captchaPresent] };
          if (cpt.solver) {
            cpt = {
              ...cpt,
              questionElementText: await helper.checkAndReturnProp(cpt.questionElement, 'CSS', 'textContent'),
              imageElementText: await helper.checkAndReturnProp(cpt.imageElement, 'CSS', 'src'),
              fetchRetry: helper.fetchRetry.bind(helper),
              inputs,
            };
          }
        }
        try {
          const solved = await solver(cpt, { timeout, timeoutOffset });
          console.log(solved);
          if (cpt.questionElement) {
            await helper.checkAndClick(cpt.inputElement, solved, 'CSS');
          }
        } catch (error) {
          throw new Error(`Capctha solver error: ${error.message}`);
        }
        // wait a sec
        await new Promise(resolve => setTimeout(resolve, timeout));
      }

      if (sumbitCaptchaOrderedActions || submitCaptchaButtonCSS) {
        const actions = sumbitCaptchaOrderedActions || [];
        if (submitCaptchaButtonCSS) actions.push({ selectorOrXpath: submitCaptchaButtonCSS });
        const lastAction = actions[actions.length - 1];
        actions[actions.length - 1] = {
          ...(Object(lastAction) ? { ...lastAction } : { selectorOrXpath: lastAction }),
          waitDisappear: true,
        };
        await processActions({ inputs, actions });
      }
      console.log('Captcha submitted and should be resolved.');
    }
    if (captchaCounter >= maxCaptcha && await isThereACaptcha()) {
      console.log('Blocked');
      return helper.context.reportBlocked(701, 'Blocked with too many captcha');
    }
    return null;
  },
};
