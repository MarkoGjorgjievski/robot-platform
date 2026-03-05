/* eslint-disable no-await-in-loop */
/**
* @param {{ selectorOrXpath: string, inputValue: string, wait: number}[]} inputs
* @param { Record<string, any> } parameters
* @param { ImportIO.IContext } context
* @param { Record<string, any> } dependencies
*/

// When provided with an array of actions (selectorOrXpath, inputValue, wait) will execute them in order

module.exports = {
  dependencies: { helperModule: 'module:helpers/helpers', solveCaptcha: 'action:captchas/solveCaptchas' },
  implementation: async ({ inputs, options }, parameters, context, dependencies) => {
    const { helperModule: { Helpers }, solveCaptcha } = dependencies;
    const helper = new Helpers(context);
    const {
      url = '',
      antiCaptchaOptions = { type: ['GEETEST', 'HCAPTCHA', 'RECAPTCHA', 'PERIMETERX', 'IMAGECAPTCHA'] },
      gotoOptions = {},
      captchaTimeout = 6000, // controls the waitForCaptcha and waitForNavigation
      timeoutOffset = 1000, // controls a static timeout offset for repeated captcha
      userAgent = '',
      submitCaptchaButtonCSS = '',
      captchaSelectors = {
        HCAPTCHA: 'form#challenge-form', GEETEST: 'iframe[src^="https://geo.captcha-delivery.com/captcha/"]', RECAPTCHA: 'div.re-captcha', PERIMETERX: '#px-captcha iframe[style~="block;"]', IMAGECAPTCHA: { inputElement: 'form input[type=text][name]', imageElement: 'img.captcha-code' },
      }, // must be css
      isCaptchaInNestedIframe = false,
      validPageSelector = '',
      waitAfterNavObject = { wrongRedirectSelector: '//div[@id="sign-in-widget"][not(.//div[@class="re-captcha"])]', selector: '//span[contains(.,"Checking your browser before accessing")]', selectorType: 'XPATH', delay: 6000 }, // object to handle cloudflare type of wait
      hardBlockChecks = ['Vous avez été bloqué', 'You have been blocked'],
      maxCaptcha = 3,
    } = options;
    if (userAgent) {
      // 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/80.0.3987.163 Safari/537.36/xGHzvfMy-13'
      await context.setUserAgent(userAgent);
    }
    let responseStatus = {};
    try {
      responseStatus = await context.goto(url, { checkBlocked: false, antiCaptchaOptions, ...gotoOptions });
    } catch (error) {
      console.log(error);
      const statusCode = responseStatus?.status;
      if (statusCode) {
        console.log(`Goto failed, reporting blocked IP with code: ${statusCode}`);
        return context.reportBlocked(699, `Goto failed, reporting blocked IP with code: ${statusCode}`);
      }
      throw new Error(`Goto error: ${error.message}`);
    }
    console.log(`Started navigation to ${url}, response: ${responseStatus.status}`);

    await helper.waitBlocking(waitAfterNavObject);

    await solveCaptcha({
      inputs,
      options: {
        captchaSelectors,
        hardBlockChecks,
        maxCaptcha,
        validPageSelector,
        isCaptchaInNestedIframe,
        submitCaptchaButtonCSS,
        timeout: captchaTimeout,
        timeoutOffset,
      },
    });

    // cehck for wrong redirect after capctha
    await helper.waitBlocking(waitAfterNavObject);
    return responseStatus;
  },
};
