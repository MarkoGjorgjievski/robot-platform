module.exports = {
  implements: 'navigation/goto',
  parameterValues: {
    country: 'US',
    domain: 'amazon.com',
    store: 'amazon',
  },
  implementation: async ({ url }, parameterValues, context) => {
    const memory = {};
    const backconnect = !!memory.backconnect;
    console.log('backconnect', backconnect);
    const benchmark = !!memory.benchmark;
    console.log('benchmark', benchmark);
    const start = Date.now();
    const MAX_CAPTCHAS = 3;

    // let pageId;
    let captchas = 0;
    let hasCaptcha = false;
    let lastResponseData;
    // eslint-disable-next-line
    // const js_enabled = true; // Math.random() > 0.7;
    // console.log('js_enabled', js_enabled); ;

    const isCaptcha = async () => await context.evaluate(async () => {
      const captchaEl = document.evaluate("//img[contains(@src,'/captcha/')]", document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
      if (captchaEl.snapshotLength) {
        return 'true';
      }
      return 'false';
    });

    const solveCaptcha = async () => {
      console.log('isCaptcha', true);

      await context.solveCaptcha({
        type: 'IMAGECAPTCHA',
        inputElement: 'form input[type=text][name]',
        imageElement: 'form img',
        autoSubmit: true,
      });
      console.log('solved captcha, waiting for page change');
      context.waitForNavigation();
      console.log('Captcha vanished');
    };

    const solveCaptchaIfNecessary = async () => {
      console.log('Checking for CAPTCHA');
      while (await isCaptcha() === 'true' && captchas < MAX_CAPTCHAS) {
        captchas += 1;
        if (backconnect) {
          throw Error('CAPTCHA received');
        }
        console.log('Solving a captcha', await isCaptcha(), captchas);
        await solveCaptcha();
      }
      if (await isCaptcha() === 'true') {
        if (!benchmark) {
          // we failed to solve the CAPTCHA
          console.log('We failed to solve the CAPTCHA');
          return context.reportBlocked(lastResponseData.code, `Blocked: Could not solve CAPTCHA, attempts=${captchas}`);
        }
        return false;
      }
      return true;
    };
    const run = async () => {
      // do we perhaps want to go to the homepage for amazon first?
      lastResponseData = await context.goto(url, {
        timeout: 10000,
        waitUntil: 'load',
        checkBlocked: true,
        js_enabled: true,
        css_enabled: false,
        random_move_mouse: true,
      });

      if (lastResponseData.status === 404 || lastResponseData.status === 410) {
        return null;
      }

      if (lastResponseData.status === 503) {
        console.log('Clicking 503 image');
        await context.click('a img[src*="503.png"], a[href*="ref=cs_503_link"]');

        console.log('Waiting for page to reload on homepage');
        context.waitForNavigation();
        if (!await solveCaptchaIfNecessary()) {
          hasCaptcha = true;
          return null;
        }

        console.log('Go to some random page');
        const clickedOK = await context.evaluate(async () => { //* [contains(@id,'contextualIngressPtLabel_deliveryShortLine')]/spa
          const randomLinkEls = document.evaluate("a[href*='/dp/']", document, null, XPathResult.ANY_TYPE, null);
          const randomLinkEl = randomLinkEls.iterateNext();
          if (randomLinkEl) {
            // @ts-ignore
            randomLinkEl.click();
            return 'true';
          }
          return 'false';
        });

        if (clickedOK === 'false') {
          console.log('Could not click a product, aborting... :/');
          return null;
        }
        context.waitForNavigation();

        console.log('Going back to desired page');
        lastResponseData = await context.goto(url, {
          timeout: 10000,
          waitUntil: 'load',
          checkBlocked: true,
          js_enabled: true,
          css_enabled: false,
          random_move_mouse: true,
        });
        console.log('lastResponseData', lastResponseData);
      }

      if (lastResponseData.status === 404 || lastResponseData.status === 410) {
        return null;
      }

      if (lastResponseData.status !== 200) {
        console.log(`Blocked: ${lastResponseData.status}`);
        if (benchmark) {
          return null;
        }
        if (backconnect) {
          throw Error(`Bad response code: ${lastResponseData.code}`);
        }
        return context.reportBlocked(lastResponseData.status, `Blocked: ${lastResponseData.status}`);
      }

      if (!await solveCaptchaIfNecessary) {
        hasCaptcha = true;
        return null;
      }

      if (lastResponseData.status === 404 || lastResponseData.status === 410) {
        return null;
      }

      const wrongLocale = await context.evaluate(async () => {
        const detailsLocaleEl = document.evaluate("//*[contains(@id,'contextualIngressPtLabel_deliveryShortLine')]/span", document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
        const searchLocaleEl = document.evaluate("//span[@id='glow-ingress-line1']//*[contains(text(),':')]", document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
        if (!!detailsLocaleEl.snapshotLength || !!searchLocaleEl.snapshotLength) {
          return 'true';
        }
        return 'false';
      });

      if (wrongLocale === 'true' && !benchmark) {
        console.log('wrongLocale', !benchmark, wrongLocale);
        const txt = 'Incorrect locale detected';
        console.log(txt);
        if (backconnect) {
          throw new Error(txt);
        }
        throw new Error(txt);
        // return extractorContext.raiseError('WRONG_GEO', 'Incorrect locale detected');
      }
      return null;
    };

    try {
      await run();
    } finally {
    // needs to be non-fat arrow
      await context.evaluate((captchaCount, duration, js, hasCapt) => {
        const captchasElt = document.createElement('meta');
        captchasElt.name = 'captchas';
        captchasElt.content = captchaCount;
        document.head.appendChild(captchasElt);
        const hasCaptchaElt = document.createElement('meta');
        hasCaptchaElt.name = 'hasCaptcha';
        hasCaptchaElt.content = hasCapt;
        document.head.appendChild(hasCaptchaElt);
        const timeElt = document.createElement('meta');
        timeElt.name = 'durationmillis';
        timeElt.content = duration;
        document.head.appendChild(timeElt);
        const javascriptElt = document.createElement('meta');
        javascriptElt.name = 'javascript';
        javascriptElt.content = js;
        document.head.appendChild(javascriptElt);
        // js_enabled
      }, [captchas, Date.now() - start, hasCaptcha]);
    }
  },
};
