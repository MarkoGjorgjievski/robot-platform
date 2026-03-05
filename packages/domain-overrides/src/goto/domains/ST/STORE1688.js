module.exports = {
  implements: 'navigation/goto',
  parameterValues: {
    domain: 'STORE1688',
    timeout: null,
    jsonToTable: null,
    country: 'CN',
    schemaYAML: 'multiPages',
  },
  dependencies: { helperModule: 'module:helpers/helpers' },
  implementation: async (inputs, parameters, context, dependencies) => {
    const { url, loadedXpath, loadedSelector, loadingTimeout = 5000 } = inputs;
    const { helperModule: { Helpers } } = dependencies;
    const helper = new Helpers(context);
    const {
      captureRequests = false,
      blockUnnecessaryRequests = false,
      setBlockAds = true,
      setBypassCSP = true,
      setLoadAllResources = false,
      setLoadImages = false,
      setCssEnabled = false,
      applyIgnoreVBAndCookies = false,
      submitCaptchaButtonCSS = '',
      optTags = '',
      waitUntil = 'networkidle0',
      acceptCookiesCSSSelector = '',
      waitForCookiesSelectorTimeout = 3000,
      captchaSelectors = {}, // keep empty object if no captchas, otherwise build like so: { captchaType1: captchaSel, ...}
      waitAfterNavObject = {}, // object to handle cloudflare type of wait
      firstRequestTimeout = 31000,
      timeout = 60000, // controls the goto timeout
      captchaTimeout = 5000, // controls the waitForCaptcha and waitForNavigation
      timeoutOffset = 1000, // controls a static timeout offset for repeated captcha
      isCaptchaInNestedIframe = false, // deprecated
      validPageSelector = '', // specify a selector to interrupt the captcha solver
      maxCaptcha = 3, // controls the total number of attempts to solve a captcha before returning blocked
      hardBlockChecks = null, // specify clear text on the page that if found the whole extraction is stopped and marked as blocked, can cause issues if set
      userAgent = '',
      force200 = false,
      retryGotoUntilLoadedCSSorXpath = false, // If the loadedCSS/LoadedXpath doesn't match the goto will be attempted again
      rawOptions = {},
      gotoRetries = 1, // controls the number of retries for the goto
    } = { ...parameters, ...(inputs.goto2 || {}) };

    /* eslint-disable no-undef */
    // @ts-ignore
    if (blockUnnecessaryRequests && Array.isArray(blockUnnecessaryRequests) && typeof extractorContext !== 'undefined') {
      console.log(`ExtractorContext was set to block: ${blockUnnecessaryRequests}`);
      // @ts-ignore
      await extractorContext.blockRequests(blockUnnecessaryRequests);
      /* eslint-enable no-undef */
    }

    await context.setFirstRequestTimeout(firstRequestTimeout);
    await context.setBypassCSP(setBypassCSP);
    await context.setBlockAds(setBlockAds);
    await context.setLoadAllResources(setLoadAllResources);
    await context.setLoadImages(setLoadImages);
    await context.setCssEnabled(setCssEnabled);
    if (captureRequests) await context.captureRequests();

    const finalOptTags = `${optTags || ''}${applyIgnoreVBAndCookies ? '"cookies":[],"storage":{}' : ''}`;
    const destinationURL = finalOptTags ? `${url}#[!opt!]{${finalOptTags}}[/!opt!]` : url;

    let iter = 0;
    let gotoComplete = false;
    let gotoError;
    while (!gotoComplete && iter <= gotoRetries) {
      iter += 1;
      try {
        // eslint-disable-next-line no-await-in-loop
        await context.evaluate(() => {
          console.log('==== Starting customGoto for 1688 ====');
          const slider = document.getElementById('nc_1_n1t');
          const handle = document.getElementById('nc_1_n1z');
          let startX = 0;
          // Function to handle mouse move event
          function handleMouseMove() {
            startX += handle.clientWidth;
            // Limit slider handle within slider bounds
            console.log('in mousemove', startX, `${startX}px`);
            document.getElementById('nc_1_n1z').style.left = `${startX}px`;
          }
          // Function to handle mouse up event
          function handleMouseUp() {
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
            // Simulate a click event on the final position
            handle.dispatchEvent(new MouseEvent('click', { bubbles: true }));
          }

          // Function to handle mouse down event
          async function handleMouseDown() {
            startX = handle.clientWidth;

            const rect = slider.getBoundingClientRect();

            const tot = slider.clientWidth - handle.clientWidth;
            for (let index = 0; index < tot / handle.clientWidth - 1; index += 1) {
              console.log('rect', rect.width, index, slider.clientWidth - handle.clientWidth, startX);
              handle.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
              await new Promise(resolve => setTimeout(resolve, 100));
            }
            handle.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
          }

          document.addEventListener('mousemove', handleMouseMove);
          document.addEventListener('mouseup', handleMouseUp);
          handle.addEventListener('mousedown', handleMouseDown);

          handle.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
          console.log('==== Custom goto done! ====');
        });
        // eslint-disable-next-line no-await-in-loop
        await helper.gotoWithCaptchaSolver(destinationURL, {
          antiCaptchaOptions: { type: ['GEETEST', 'HCAPTCHA', 'RECAPTCHA', 'PERIMETERX', 'IMAGECAPTCHA'] },
          gotoOptions: {
            firstRequestTimeout, waitUntil, ignore_vb: applyIgnoreVBAndCookies, timeout, gotoTimeout: timeout, force200, ...rawOptions,
          },
          captchaTimeout,
          timeoutOffset,
          userAgent,
          submitCaptchaButtonCSS,
          captchaSelectors,
          isCaptchaInNestedIframe,
          validPageSelector,
          waitAfterNavObject,
          hardBlockChecks,
          maxCaptcha,
        });
        if (retryGotoUntilLoadedCSSorXpath) {
          gotoComplete = await helper.optionalWait(loadedXpath || loadedSelector, loadingTimeout, loadedXpath ? 'XPATH' : 'CSS');
        } else {
          gotoComplete = true;
        }
      } catch (error) {
        gotoError = error;
        console.log(error);
      }
    }
    if (iter > gotoRetries && gotoError) throw new Error(gotoError);

    if (acceptCookiesCSSSelector) await helper.ifThereClickOnIt(acceptCookiesCSSSelector, waitForCookiesSelectorTimeout);
  },
};
