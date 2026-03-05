import { optionalWait } from './wait.ts';
import { checkSelector, checkCSSSelector, checkAndReturnProp, checkAndSetProp, checkAndClick } from './dom.ts';
import { searchInFullPage } from './iframe.ts';
import { ifThereClickOnIt } from './misc.ts';
import { helperFetch, fetchRetry } from './fetch.ts';

export async function waitBlocking(context: any, waitAfterNavObject: any = {}): Promise<any> {
  const { selector, wrongRedirectSelector, selectorType, delay } = waitAfterNavObject;
  if (!wrongRedirectSelector && !selector) return null;
  try {
    await optionalWait(context, wrongRedirectSelector, delay);
    const isWronglyRedirected = await checkSelector(context, wrongRedirectSelector, selectorType);
    if (isWronglyRedirected) {
      console.log('Blocked');
      return context.reportBlocked(702, 'Soft blocked');
    }
  } catch (error) {
    const isDelayed = await checkSelector(context, selector, selectorType);
    if (isDelayed) await new Promise(resolve => setTimeout(resolve, delay));
    else throw error;
  }
  return null;
}

export async function solveCaptcha(context: any, {
  captchaSelectors, hardBlockChecks, maxCaptcha, validPageSelector, isCaptchaInNestedIframe, submitCaptchaButtonCSS, inputs,
}: any, { timeout, timeoutOffset = 1000 }: { timeout: number; timeoutOffset?: number }): Promise<any> {
  let captchaCounter = 0;
  const captchas = Object.keys(captchaSelectors);
  const solvers: Record<string, any> = {
    RECAPTCHA: { key: 'grecaptcha', funct: 'execute' },
    GEETEST: { key: '_geetest', funct: '_solve' },
  };
  const isNotHardBlocked = async () => {
    for (let index = 0; index < captchas.length; index += 1) {
      const captcha = captchas[index];
      const captchaSelector = captchaSelectors[captcha].inputElement || captchaSelectors[captcha];
      const isHardBlocked = hardBlockChecks ? await searchInFullPage(context, captchaSelector, hardBlockChecks) : false;
      if (isHardBlocked) {
        console.log('Blocked');
        await context.reportBlocked(700, 'Hard blocked');
        return false;
      }
    }
    return true;
  };
  const isThereACaptcha = async (captchaCount?: number) => {
    const prophasBeenSeen = 'hasbeenseen';
    const waitTime = captchaCount ? timeout + timeoutOffset : timeout;
    for (let index = 0; index < captchas.length; index += 1) {
      const captcha = captchas[index];
      const captchaSelector = captchaSelectors[captcha].imageElement || captchaSelectors[captcha].inputElement || captchaSelectors[captcha];
      await optionalWait(context, captchaSelector, waitTime);
      const isCaptchaFramePresent = await checkSelector(context, captchaSelector, 'CSS');
      const hasbeenseen = await checkAndReturnProp(context, captchaSelector, 'CSS', prophasBeenSeen);
      const isOnValidPage = validPageSelector ? await checkSelector(context, validPageSelector, 'CSS') : false;
      const endtext = validPageSelector ? ` and the page is ${isOnValidPage ? '' : 'not '} a valid data page` : '';
      const hasbeenSeenText = hasbeenseen ? ', but has already been seen - it will be ignored' : '';
      console.log(`Captcha of type: ${captcha} is ${isCaptchaFramePresent ? '' : 'not '}present${hasbeenSeenText}${endtext}`);
      if (isCaptchaFramePresent && !hasbeenseen) {
        await checkAndSetProp(context, captchaSelector, 'seen', 'CSS', prophasBeenSeen);
        return captcha;
      }
    }
    return '';
  };
  let captchaPresent;
  while ((captchaPresent = await isThereACaptcha(captchaCounter)) && captchaCounter < maxCaptcha && await isNotHardBlocked()) {
    const solver = solvers[captchaPresent]?.solver || captchaSelectors[captchaPresent]?.solver || context.solveCaptcha;
    captchaCounter += 1;
    if (isCaptchaInNestedIframe) {
      await context.evaluateInFrame('iframe', ({ key, funct }: { key: string; funct: string }) => (window as any)[key][funct](), solvers[captchaPresent]);
    } else {
      let cpt: any = { type: captchaPresent, inputElement: 'iframe' };
      if (captchaSelectors[captchaPresent] === Object(captchaSelectors[captchaPresent])) {
        cpt = { ...cpt, ...captchaSelectors[captchaPresent] };
        if (cpt.solver) {
          cpt = {
            ...cpt,
            questionElementText: await checkAndReturnProp(context, cpt.questionElement, 'CSS', 'textContent'),
            imageElementText: await checkAndReturnProp(context, cpt.imageElement, 'CSS', 'src'),
            fetchRetry: (...args: any[]) => fetchRetry(context, ...args),
            inputs,
          };
        }
      }
      try {
        console.log(solver, solvers[captchaPresent]?.solver, captchaSelectors[captchaPresent]?.solver, context.solveCaptcha);
        const solved = await solver(cpt, { timeout, timeoutOffset });
        console.log(solved);
        if (cpt.questionElement) {
          await checkAndClick(context, cpt.inputElement, solved, 'CSS');
        }
      } catch (error: any) {
        throw new Error(`Capctha solver error: ${error.message}`);
      }
      await new Promise(resolve => setTimeout(resolve, timeout));
    }
    if (submitCaptchaButtonCSS) {
      await ifThereClickOnIt(context, submitCaptchaButtonCSS);
      const maxLoopIter = 3;
      let index = 0;
      while (await checkCSSSelector(context, submitCaptchaButtonCSS) && index < maxLoopIter) {
        await new Promise(resolve => setTimeout(resolve, timeout));
        index += 1;
      }
    }
    console.log('Captcha submitted and should be resolved.');
  }
  if (captchaCounter >= maxCaptcha && await isThereACaptcha()) {
    console.log('Blocked');
    return context.reportBlocked(701, 'Blocked with too many captcha');
  }
  return null;
}

export async function gotoWithCaptchaSolver(context: any, url: string, {
  inputs = {},
  antiCaptchaOptions = { type: ['GEETEST', 'HCAPTCHA', 'RECAPTCHA', 'PERIMETERX', 'IMAGECAPTCHA'] },
  gotoOptions = {},
  captchaTimeout = 6000,
  timeoutOffset = 1000,
  userAgent = '',
  submitCaptchaButtonCSS = '',
  captchaSelectors = {
    HCAPTCHA: 'form#challenge-form', GEETEST: 'iframe[src^="https://geo.captcha-delivery.com/captcha/"]', RECAPTCHA: 'div.re-captcha', PERIMETERX: '#px-captcha iframe[style~="block;"]', IMAGECAPTCHA: { inputElement: 'form input[type=text][name]', imageElement: 'img.captcha-code' },
  },
  isCaptchaInNestedIframe = false,
  validPageSelector = '',
  waitAfterNavObject = { wrongRedirectSelector: '//div[@id="sign-in-widget"][not(.//div[@class="re-captcha"])]', selector: '//span[contains(.,"Checking your browser before accessing")]', selectorType: 'XPATH', delay: 6000 },
  hardBlockChecks = ['Vous avez été bloqué', 'You have been blocked'],
  maxCaptcha = 3,
}: any = {}): Promise<any> {
  if (userAgent) {
    await context.setUserAgent(userAgent);
  }
  let responseStatus: any = {};
  try {
    responseStatus = await context.goto(url, { checkBlocked: false, antiCaptchaOptions, ...gotoOptions });
  } catch (error: any) {
    console.log(error);
    const statusCode = responseStatus?.status;
    if (statusCode) {
      console.log(`Goto failed, reporting blocked IP with code: ${statusCode}`);
      return context.reportBlocked(699, `Goto failed, reporting blocked IP with code: ${statusCode}`);
    }
    throw new Error(`Goto error: ${error.message}`);
  }
  console.log(`Started navigation to ${url}, response: ${responseStatus.status}`);
  await waitBlocking(context, waitAfterNavObject);
  await solveCaptcha(context, {
    captchaSelectors, hardBlockChecks, maxCaptcha, validPageSelector, isCaptchaInNestedIframe, submitCaptchaButtonCSS, inputs,
  }, { timeout: captchaTimeout, timeoutOffset });
  await waitBlocking(context, waitAfterNavObject);
  return responseStatus;
}

