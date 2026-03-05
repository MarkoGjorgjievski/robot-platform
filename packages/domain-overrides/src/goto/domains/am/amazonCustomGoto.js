/* eslint-disable no-continue */
module.exports = {
  implementation: async (gotoInput, parameterValues, context, dependencies) => {
    const { helperModule: { Helpers } } = dependencies;
    const helper = new Helpers(context);
    const { city, keywords, captureRequest } = gotoInput;
    const parseZipcodes = inputZipcodes => (Array.isArray(inputZipcodes) ? inputZipcodes : [inputZipcodes]).map(zip => zip?.toString() || '');
    const zipcodes = parseZipcodes(gotoInput.zipcode || parameterValues.zipcode || '');
    const MAX_CAPTCHAS = gotoInput.MAX_CAPTCHAS || 3;
    const MAX_SESSION_RETRIES = gotoInput.MAX_SESSION_RETRIES || 2;
    const MAX_NBZIPTRYOUTS = gotoInput.MAX_SESSION_RETRIES || 2;
    const MAX_OTHERBLOCKS = gotoInput.MAX_OTHERBLOCKS || 1;
    const FAIL_SORRY_PAGE = gotoInput.FAIL_SORRY_PAGE ?? parameterValues.FAIL_SORRY_PAGE ?? true;
    const timeout = 40000;
    const ALWAYS_APPEND_DATA = gotoInput.ALWAYS_APPEND_DATA || false;
    await context.setFirstRequestTimeout(90000);
    await context.setBlockAds(false);
    await context.setBypassCSP(false);
    // keep to false to prevent high bandwidth
    await context.setLoadAllResources(true);
    await context.setLoadImages(true);
    await context.setCssEnabled(true);
    if (captureRequest) await context.captureRequests();
    const blockedRequests = null; // '<xhr|script|font|stylesheet|media>, .png, .gif, .svg, .woff2, .ico, favicon, media';
    console.log(`ExtractorContext was set to block: ${blockedRequests}`);
    /* eslint-disable no-undef */
    // @ts-ignore
    if (blockedRequests && typeof extractorContext !== 'undefined') {
      console.log(`ExtractorContext was set to block: ${blockedRequests}`);
      // @ts-ignore
      await extractorContext.blockRequests(blockedRequests.split(',').map((str, ind) => (ind === 0 ? str : new RegExp(`.*${str.trim().replace('.', '\\.')}.*`, 'i'))));
      /* eslint-enable no-undef */
    }

    // strategies can  be  turned on and off
    const fillRateStrategies = {
      variantAPIAppendData: gotoInput.variantAPIAppendData,
      nonVariantReload: gotoInput.nonVariantReload,
      variantReload: gotoInput.variantReload,
      acceptCookies: gotoInput.acceptCookies ?? true,
      // missingDataRetry has dependants
      missingDataRetry: gotoInput.missingDataRetry ?? true,
      // dependant on missingDataRetry
      cleanCookieRetry: gotoInput.cleanCookieRetry ?? true,
      // dependant on missingDataRetry
      salesRankBadgeRetry: gotoInput.salesRankBadgeRetry,
      // dependant on missingDataRetry
      aplusRetry: gotoInput.aplusRetry,
      // dependant on missingDataRetry
      hasInlineSponsoredProducts: gotoInput.hasInlineSponsoredProducts ?? false,
      descriptionRetry: gotoInput.descriptionRetry,
      hourlyRetryLimit: gotoInput.hourlyRetryLimit,
      ignoreVBAndCookies: gotoInput.ignoreVBAndCookies,
      inSessionRetries: gotoInput.inSessionRetries ?? false,
      doNotSetZip: gotoInput.doNotSetZip ?? false,
    };
    console.log('fillRateStrategies: ', fillRateStrategies);

    let lastResponseData;
    let lastResponseCode;
    let nbZiptryouts = 0;

    const isBlankPage = page => !Object.values(page).find(item => item === true);

    // checking for elements on page after goto/captcha/reload/etc.
    // eslint-disable-next-line arrow-body-style
    const pageContext = async () => {
      return Object.entries(await context.evaluate(() => Object.entries({
        //  css selectors
        hasProdDetails: '#prodDetails, #detailBullets_feature_div',
        hasSalesRank: '#detailBullets_feature_div a[href*="bestsellers"], #detailBullets a[href*="bestsellers"], #prodDetails a[href*="bestsellers"], #SalesRank',
        isProductPage: 'link[rel*=canonical][href*="/dp/"]',
        isSorryPage: '#dpSorryPage,#dp-container div[cel_widget_id="dpx-ppd_csm_instrumentation_wrapper"] div.a-alert-error[aria-live="assertive"]',
        isReviewsPage: 'link[rel*=canonical][href*=product-reviews]',
        isBestSellerPage: 'link[rel*=canonical][href*="/zgbs/"]',
        isSearchPage: '#search',
        hasPagination: 'ul.a-pagination',
        hasSalesRankBadge: '#ppd i[class*="best-seller-badge"]',
        isCaptchaPage: 'img[src*="/captcha/"]',
        hasAplus: '#aplus',
        hasProductDescription: '#productDescription',
        hasShippingDetails: '#contextualIngressPtLabel_deliveryShortLine',
        hasCookieAcceptRequest: '#sp-cc-accept',
        hasDogsofAmazon: 'img[alt*="Dogs of Amazon"]',
        is400Page: 'a[href*="404_logo"]',
        is500Page: 'img[src*="500-title"], a[href*="503_logo"], a img[src*="503.png"], a[href*="ref=cs_503_link"]',
        hasTitle: 'title, #gouda-common-atf h1',
        isPrimeVideo: '[value="search-alias=instant-video"][selected="selected"]',
        isHomePage: '#gw-layout',
      }).reduce((acc, [key, selector]) => ({ ...acc, [key]: !!document.querySelector(selector) }), {
        // coming from the window element, xpath selectors, or get functions
        // @ts-ignore
        hasShoppingCart: window.ue_pty?.includes('ShoppingCart'),
        // @ts-ignore
        isCartPage: window.ue_pty?.includes('ShoppingCart') && window.ue_spty?.includes('Cart'),
        hasInlineSponsoredProducts: document.evaluate('count(//div[contains(@data-component-type,"s-search-result") and @data-asin and contains(@class, "AdHolder")])', document, null, XPathResult.ANY_TYPE, null).numberValue,
        // @ts-ignore
        isCartTransitionPage: window.ue_pty?.includes('ShoppingCart') && !window.ue_spty?.includes('Cart'),
        // @ts-ignore
        isBestSellerPage: window.ue_pty?.includes('zeitgeist'),
        // @ts-ignore
        isSearchPage: window.ue_pty?.includes('Search'),
        // @ts-ignore
        isReviewsPage: window.ue_pty?.includes('CustomerReviews'),
        // @ts-ignore
        isOffersPage: window.ue_pty?.includes('OfferListing') || Boolean(window.location.pathname === '/gp/aod/ajax'),
        // @ts-ignore
        isFreshContentPage: window.ue_pty?.includes('FreshMerchandisedContent'),
        // @ts-ignore
        hasDetails: window.ue_pty?.includes('Detail'),
        bestSellerCount: document.evaluate("//ol[@id='zg-ordered-list']/li | //div[contains(@class,'desktop-grid')]//div[@id='gridItemRoot']", document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null)?.snapshotLength || 0,
        // @ts-ignore
        hasVariants: !!window.isTwisterPage,
        windowLocation: window.location,
        get isProductPage() {
          // @ts-ignore
          return this.hasTitle && this.hasDetails && !!window.ue_pty;
        },
      }))).reduce((acc, [key, val]) => (val ? { ...acc, [key]: val } : acc), {});
    };

    const getZipCode = async () => {
      // @ts-ignore
      const country = await context.evaluate(() => document.querySelector('[lang]')?.lang?.match(/[^-]+$/)[0].toUpperCase());
      const zipcodeToUse = !zipcodes?.[0] && country === 'US' ? '10001' : zipcodes?.[0]; // random zipcode --> + (Math.floor(Math.random() * 20) + 1);
      const zipText = await helper.checkAndReturnProp('div#glow-ingress-block', 'CSS', 'textContent');
      const zipcodeIsSet = (!!zipcodes.filter(x => (zipText?.includes(x?.slice(0, -2))
             || zipText?.includes(x.replace(/[-\s]/g, ''))
      )).length) && (!city || zipText?.includes(city));
      console.log(`Currently the zipcode is ${zipcodeIsSet ? '' : 'not '}set to ${zipcodeToUse}`);
      return { zipcode: zipcodeToUse, zipcodeIsSet };
    };

    const setZipWithUI = async (zipcodeToUse) => {
      console.log('Start the process of setting the zipcode with the UI');
      if (!await helper.checkSelector('.a-popover')) await helper.ifThereClickOnIt('#nav-global-location-popover-link', 2000); // click on the set zipcode
      await helper.optionalWait('.a-popover-inner div div + div', 8000); // wait for the popover to fully load
      // await helper.ifThereClickOnIt('.a-popover .a-button-toggle a'); // click on the 'Change' toggle button if it is there
      await helper.checkAndClick('input[aria-label*="zip code"], input[aria-label*="postcode"], input[aria-label*="postal code"]', zipcodeToUse, 'CSS'); // set the zipcode
      await new Promise(resolve => setTimeout(resolve, 2000)); // small wait to ensure zipcode was set
      await helper.ifThereClickOnIt('input.a-button-input[aria-labelledby*="pdate"]'); // click on apply
      await helper.ifThereClickOnIt('.a-popover-footer *[type]'); // click on done
      await new Promise(resolve => setTimeout(resolve, 6000)); // let the page reload automatically
      return (await getZipCode()).zipcodeIsSet;
    };

    const fetchHTML = (endpoint, { headers, append = true, match = false }, optn = { method: 'GET', mode: 'cors', credentials: 'include' }) => context
      .evaluate((endpointVal, headerObj, optnVal) => fetch(endpointVal, {
        headers: headerObj.append
          ? {
            Accept: 'text/html,*/*',
            'Accept-language': 'en-US,en;q=0.9',
            // @ts-ignore
            'anti-csrftoken-a2z': document.querySelector('#glowValidationToken')?.value,
            Host: window.location.host,
            Referer: window.location.href,
            'Sec-Fetch-Dest': 'empty',
            'Sec-Fetch-Mode': 'cors',
            'Sec-Fetch-Site': 'same-origin',
            'User-Agent': window.navigator.userAgent,
            ...headerObj.headers,
            'X-Requested-With': 'XMLHttpRequest',
          }
          : headerObj.headers,
        ...optnVal,
      }).then(r => r.text()).then(txt => (headerObj.match ? txt?.match(/CSRF_TOKEN\s*:\s*"([^"]+)/) : txt)).catch((err) => { console.log(err); return false; }), endpoint, { headers, append, match }, optn);

    const setZipWithAPI = async (zipcodeToUse, page) => {
      const { dataCategory: storeContext = 'generic' } = await helper.checkAndReturnProp('#nav-subnav', 'CSS', 'dataset') || {};
      const { origin } = page.windowLocation;
      // @ts-ignore
      const pageType = await context.evaluate(() => ((window.opts && window.opts.pageType) || 'Gateway'));
      const api = `${origin}/gp/glow/get-address-selections.html?deviceType=desktop&pageType=${pageType}&storeContext=${storeContext}&actionSource=desktop-modal`;
      const api2 = `${origin}/portal-migration/hz/glow/get-rendered-address-selections`;
      const Cookie = await context.evaluate(() => document.cookie);

      // get csrf token using 2 possible apis
      const csrfToken = await fetchHTML(api, { headers: { Downlink: '10', Ect: '4g', Rtt: '200' }, match: true })
      || await fetchHTML(api2, { headers: { Cookie }, match: true });

      return await fetchHTML(`${origin}/gp/delivery/ajax/address-change.html`, {
        headers: {
          accept: 'text/html,*/*',
          'accept-language': 'en-GB,en-US;q=0.9,en;q=0.8',
          'anti-csrftoken-a2z': csrfToken?.[1],
          'content-type': 'application/x-www-form-urlencoded',
          'x-requested-with': 'XMLHttpRequest',
        },
        append: false,
      // @ts-ignore
      }, {
        body: `locationType=LOCATION_INPUT&zipCode=${zipcodeToUse}&storeContext=${storeContext}&deviceType=web&pageType=${pageType}&actionSource=glow&almBrandId=undefined`,
        method: 'POST',
      });
    };

    const setZip = async (zipcodeToUse, page) => {
      if (fillRateStrategies.doNotSetZip || nbZiptryouts === MAX_NBZIPTRYOUTS) return { result: true }; // bypass setting the zip
      nbZiptryouts += 1;
      if (nbZiptryouts === 1) return { needsReload: true, result: await setZipWithAPI(zipcodeToUse, page) };
      return { result: await setZipWithUI(zipcodeToUse) };
    };

    const makeSearchWithUI = async () => {
      console.log('Start the process of inputing the keywords in the search bar');
      await helper.checkAndClick('#twotabsearchtextbox', 'CSS', 2000); // click on the search bar
      await helper.optionalWait('#nav-flyout-iss-anchor', 10000); // wait for the overlay to fully load
      await helper.checkAndClick('#twotabsearchtextbox', 'CSS', 2000, keywords); // input the keywords
      await new Promise(resolve => setTimeout(resolve, 2000)); // small wait to ensure input was set
      await helper.checkAndClick('#nav-search-submit-button'); // click on apply
      await new Promise(resolve => setTimeout(resolve, 5000)); // let the page reload automatically
    };

    const clickOnAnchorLink = async (selector) => {
      const linkRef = await context.evaluate((sel) => {
        // @ts-ignore
        const links = [...document.querySelectorAll(sel === 'random' ? 'a[href*="/dp/"]' : sel)];
        if (links.length === 0) return false;
        const elem = links[Math.floor(links.length * Math.random())];
        if (elem.getAttribute('href')) return elem.getAttribute('href');
        return elem.closest('a')?.getAttribute('href');
      }, selector);
      await helper.ifThereClickOnIt(`a[href="${linkRef}"]`).catch(console.log);
    };

    // redshift element counter
    // eslint-disable-next-line no-shadow
    const counter = (page, lastResponseData, shouldHaveData) => {
      const applyCounter = obj => Object.entries(obj)
        .forEach(([key, value]) => context.counter.set(key, value ? 1 : 0));
      if (page.isProductPage) {
        applyCounter({
          aplus: page.hasAplus,
          prodDesc: page.hasProductDescription,
          description: page.hasProductDescription,
          prodDetails: page.hasProdDetails,
          details: page.hasProdDetails,
          shipDetails: page.hasShippingDetails,
          salesRank: page.hasSalesRank,
        });
      }
      applyCounter({
        primevideo: lastResponseData?.url?.includes('elasticbeanstalk') || lastResponseData?.url?.includes('www.primevideo.com'),
        expected: !!parseInt(shouldHaveData.details, 10) || page.hasProdDetails,
        hasInlineSponsoredProducts: page.isSearchPage && page.hasInlineSponsoredProducts,
      });
    };

    // calls refresh API and appends data to the page that doesnt already exist
    const appendData = async () => context.evaluate(async () => {
      let appendedCount = 0;
      async function addDivs(dataRaw, ignoreFilter) {
        console.log('# elements attempting to append: ', dataRaw.length);
        dataRaw.forEach((part) => {
          const element = document.getElementById(Object.keys(part?.Value?.content)[0]);
          if (!ignoreFilter && (element || Object.keys(part?.Value?.content)[0].match(/^dpx-.+_feature_div$/))) {
            // element.innerHTML = Object.values(part.Value.content)[0];
          } else if (!element) {
            const div = document.createElement('div');
            const [[key, value]] = Object.entries(part?.Value?.content);
            div.setAttribute('id', key);
            div.innerHTML = value;
            const appendAtBottom = document.getElementById('a-page');
            if (appendAtBottom) {
              appendAtBottom.insertBefore(div, document.getElementById('navFooter'));
              appendedCount += 1;
            } else {
              console.log('couldnt find a good place to append data');
            }
          }
        });
      }
      const parseResponse = blob => blob
        .split('&&&')
        .map(part => part.replace(/\n/g, '').trim())
        .filter(part => part.length > 0 && part.trim().match(/^{.+}$/))
        .map(part => JSON.parse(part));
      try {
        // @ts-ignore
        const asin = window.isTwisterPage ? window.twisterController.twisterJSInitData.current_asin : window.ue_pti;
        const pgIDmatch = document.querySelector('html').innerHTML.match(/productGroupID=([\w]+)|productGroupID":"([^"]+)/);
        const ptdMatch = document.querySelector('html').innerHTML.match(/productTypeName=([\w]+)|productTypeName":"([^"]+)/);
        const pgid = pgIDmatch?.[1] || pgIDmatch?.[2] || '';
        const query = Object.entries({
          asinList: asin,
          id: asin,
          // @ts-ignore
          parentAsin: window.isTwisterPage ? window.twisterController.twisterJSInitData.parent_asin : asin,
          pgid,
          psc: 1,
          triggerEvent: 'twister',
          isUDPFlag: 1,
          json: 1,
          ptd: ptdMatch?.[1] || ptdMatch?.[2] || pgid.match(/^[^_]+/)[0] || 'CELLULAR_PHONE',
          dpEnvironment: 'hardlines',
        }).map(([key, val]) => `${key}=${val}`);

        const baseApi = '/gp/twister/ajaxv2?sCac=1&twisterView=glance&auiAjax=1&json=1&dpxAjaxFlag=1&ee=2&enPre=1&dcm=1&ppw=&ppl=&isFlushing=2&dpEnvironment=hardlines&mType=full&psc=1&';
        let text = await fetch(baseApi + query.join('&')).then(r => r.text());
        if (text.trim() === '{}') {
          // Adding a random value for a product where API worked.
          query[query.findIndex(q => q.includes('pgid='))] = 'pgid=wireless_display_on_website';
          text = await fetch(baseApi + query.join('&')).then(r => r.text());
        }
        const dataRaw = parseResponse(text);
        await addDivs(dataRaw);
        if (!document.querySelector('[data-feature-name="productDetails"],[data-feature-name="detailBullets"]')) {
          console.log('Details not found. Appedning divs without condition.');
          await addDivs(dataRaw, true);
        }
        console.log('Total divs appended: ', appendedCount);
        context.counter.set('append', 1);
        return true;
      } catch (err) {
        console.log('append data try  catch fail', err);
        return false;
      }
    });

    // checks internal expected API
    const getShouldHaveData = async (url) => {
      try {
        const apiUrl = `https://moorhe2t18.execute-api.us-east-1.amazonaws.com/prod/?url=${encodeURIComponent(url || gotoInput.url)}`;

        const res = await Promise.race([
          // @ts-ignore
          // eslint-disable-next-line arrow-body-style
          context.evaluate(async (apiUrlVal) => { return fetch(apiUrlVal, { timeout: 1e3 }); }, apiUrl),
          // @ts-ignore
          new Promise((resolve, reject) => setTimeout(reject, 1000)),
        ]);
        const data = await res.json();
        if (data) console.log('expectedAPI: ', data);
        return data || { details: 0 };
      } catch (err) {
        console.error('shouldHave:error', err);
        return { details: 0 };
      }
    };

    // initalize the handling
    // redshift health counters set to 0
    context.counter.set('task', 0);
    context.counter.set('expected', 0);
    context.counter.set('primevideo', 0);
    context.counter.set('refresh', 0);
    context.counter.set('append', 0);
    context.counter.set('page503', 0);
    context.counter.set('freshContentPage', 0);
    context.counter.set('captchas', 0);
    context.counter.set('blankPage', 0);
    context.counter.set('sorryPage', 0);
    context.counter.set('page400', 0);
    context.counter.set('otherBlock', 0);
    context.counter.set('partialData', 0);
    context.counter.set('randomPage', 0);
    context.counter.set('noInlineSponsored', 0);
    context.counter.set('inputSearchBar', 0);
    context.counter.set('navigateWithClick', 0);
    context.counter.set('unexpectedPage', 0);
    context.counter.set('homePage', 0);
    context.counter.set('inSessionRetries', 0);

    const status = {
      retriesBeforeThrowing: {
        page503: { max: 3, error: 'BLOCKED: Could not work around 503' },
        freshContentPage: { max: 2, error: 'BLOCKED: FreshContentPage Redirect' },
        captchas: { max: MAX_CAPTCHAS, error: 'BLOCKED: Could not solve CAPTCHA' },
        blankPage: { max: 2, error: 'BLOCKED: data dropped' },
        sorryPage: { max: 2, error: 'BLOCKED: Sorry Page Block' },
        page400: { max: 2, error: 'BLOCKED: Sorry Page 400' },
        otherBlock: { max: MAX_OTHERBLOCKS, error: 'BLOCKED: 400 or 500 response' },
        partialData: { max: 1, error: 'MISSING:' },
        randomPage: { max: 4, error: 'BLOCKED: too many random pages' },
        // noInlineSponsored: { max: 2, error: 'MISSING: no inline sponsored data' },
        inputSearchBar: { max: 4, error: 'BLOCKED: too many attempts at search bar inputs' },
        navigateWithClick: { max: 20 },
        unexpectedPage: { max: 2, error: 'BLOCKED: cannot reach desired page, too many unexpected pages' },
        homePage: { max: 20 },
        inSessionRetries: { max: MAX_SESSION_RETRIES, error: 'MISSING: even after in session retry:' },
      },
      isFirstGoto: true,
      expects: Object.entries({
        isReviewsPage: false,
        isProductPage: false,
        isSearchPage: !!keywords,
      }).reduce((acc, [key, val]) => (val ? { ...acc, [key]: val } : acc), {}),
      isDone: false,
      gotoURL: gotoInput.url,
      tryReload: false,
      hasNeverClearedStorage: true,
      hasTriedZipBefore: false,
      get isStillTrying() {
        return Object.values(this.retriesBeforeThrowing).every(({ displayed = 0, max }) => displayed < max);
      },
      update(prop, error) { // not arrow function to be able to use this
        const obj = this.retriesBeforeThrowing[prop];
        // eslint-disable-next-line no-bitwise
        obj.displayed = -~obj.displayed;
        if (error) obj.error = `${obj.error} ${error}`;
        console.log(`Will restart the while loop and following counter was updated: ${prop} -> ${obj.displayed} with error: ${obj.error}`);
      },
      get(prop) {
        if (prop) return this.retriesBeforeThrowing[prop].displayed || 0;
        return { ...this, retriesBeforeThrowing: Object.entries(this.retriesBeforeThrowing).reduce((acc, [key, val]) => (val.displayed ? { ...acc, [key]: val } : acc), {}) };
      },
    };

    const noCookiesReloadPageOrSession = async ({ pageOnly = false }) => {
      await context.evaluate(() => {
        localStorage.clear();
        sessionStorage.clear();
      });
      status.hasNeverClearedStorage = !pageOnly;
      if (pageOnly) status.tryReload = true;
      else {
        await context.goto('about:blank');
        fillRateStrategies.ignoreVBAndCookies = true;
        status.isFirstGoto = true;
        status.hasTriedZipBefore = false;
        status.gotoURL = gotoInput.url;
      }
    };

    let iter = 0;
    while ((status.isStillTrying || status.isFirstGoto) && !status.isDone) {
      iter += 1;
      console.log(`Iteration ${iter} and status object:`, status.get());
      context.counter.set('iter', iter);
      // navigate
      if (status.tryReload) {
        console.log('Reload the page');
        await context.reload();
        status.tryReload = false;
        lastResponseCode = 199;
      // } else if (Array.isArray(status.gotoURL)) { // click on a chain of selectors or go to a random product page
      //   const clickSelector = status.gotoURL.shift();
      //   const actionMap = {
      //     random: { update: 'randomPage', fct: clickOnAnchorLink, log: 'Go to some random page', next: keywords && !status.get('inputSearchBar') ? ['inputSearchBar'] : gotoInput.url }, // to the condition to limit depending on if it was usesd before
      //     inputSearchBar: { update: 'inputSearchBar', fct: makeSearchWithUI, log: 'Make a search using the search bar' },
      //   }[clickSelector] || { update: 'navigateWithClick', fct: clickOnAnchorLink, log: `Navigate by clicking on selector: ${clickSelector}` };
      //   status.update(actionMap.update);
      //   if (actionMap.update === 'randomPage') {
      //     context.counter.increment('randomPage');
      //   } else if (actionMap.update === 'inputSearchBar') {
      //     context.counter.increment('inputSearchBar');
      //   } else if (actionMap.update === 'navigateWithClick') {
      //     context.counter.increment('navigateWithClick');
      //   }
      //   console.log(actionMap.log);
      //   await actionMap.fct(clickSelector);
      //   lastResponseCode = 199;
      //   if (!status.gotoURL.length) status.gotoURL = actionMap.next;
      //   continue;
      } else if (status.gotoURL && !Array.isArray(status.gotoURL)) {
        console.log('else if');
        const applyIgnoreVBAndCookies = status.isFirstGoto && fillRateStrategies.ignoreVBAndCookies;
        console.log(applyIgnoreVBAndCookies, status.isFirstGoto, fillRateStrategies.ignoreVBAndCookies);
        lastResponseData = await context.goto(applyIgnoreVBAndCookies ? `${status.gotoURL}#[!opt!]{"cookies":[],"storage":{}}[/!opt!]` : status.gotoURL, {
          checkBlocked: false,
          waitUntil: 'load',
          ignore_vb: applyIgnoreVBAndCookies,
          timeout,
        });
        lastResponseCode = lastResponseData?.status || 200;
        status.isFirstGoto = false;
        status.gotoURL = '';
      }
      console.log(`lastResponseData: ${JSON.stringify(lastResponseData)}, retryContextAPI: ${JSON.stringify(context.retryContext)}`);

      // check the page
      await new Promise(resolve => setTimeout(resolve, 3000));
      const page = await pageContext();

      // @ts-ignore
      if (page.isCaptchaPage) {
        console.log('page.isCaptchaPage');
        status.update('captchas');
        context.counter.increment('captchas');
        await context.solveCaptcha({
          type: 'IMAGECAPTCHA',
          inputElement: 'form input[type=text][name]',
          imageElement: 'form img',
          autoSubmit: true,
        }).catch(e => helper.throwError('Captcha solver failed', { log: e.message }));

        console.log('solved captcha, waiting for page change');
        await new Promise(resolve => setTimeout(resolve, 2000));
        if (await !helper.checkSelector('#a-popover-root')) status.tryReload = true;
        continue;
      }
      if (Array.isArray(status.gotoURL)) { // click on a chain of selectors or go to a random product page
        const clickSelector = status.gotoURL.shift();
        const actionMap = {
          random: { update: 'randomPage', fct: clickOnAnchorLink, log: 'Go to some random page', next: keywords && !status.get('inputSearchBar') ? ['inputSearchBar'] : gotoInput.url }, // to the condition to limit depending on if it was usesd before
          inputSearchBar: { update: 'inputSearchBar', fct: makeSearchWithUI, log: 'Make a search using the search bar' },
        }[clickSelector] || { update: 'navigateWithClick', fct: clickOnAnchorLink, log: `Navigate by clicking on selector: ${clickSelector}` };
        status.update(actionMap.update);
        context.counter.increment(actionMap.update);
        console.log(actionMap.log);
        await actionMap.fct(clickSelector);
        lastResponseCode = 199;
        if (!status.gotoURL.length) status.gotoURL = actionMap.next;
        continue;
      }
      // @ts-ignore
      if (page.isHomePage) {
        status.update('homePage');
        context.counter.increment('homePage');
        console.log('Is on the home page, will try to navigate to the desired page');
        if (await helper.checkSelector('#navbar-backup-backup')) status.gotoURL = gotoInput.url;
        else status.gotoURL = keywords ? ['inputSearchBar'] : gotoInput.url; // navigate to the wanted page
        continue;
      }

      // checking for blank page
      if (isBlankPage(page)) {
        context.counter.set('dropped_data', 1);
        status.update('blankPage');
        context.counter.increment('blankPage');
        status.gotoURL = gotoInput.url; // navigate to the wanted page
        continue;
      }

      // @ts-ignore
      if (page.isSorryPage && FAIL_SORRY_PAGE) {
        status.update('sorryPage');
        context.counter.increment('sorryPage');
        // set zipcode using only API
        continue;
      }

      // @ts-ignore
      if (page.isFreshContentPage) {
        console.log('FreshContentPage Page, will reload homepage using Home Logo image');
        status.update('freshContentPage');
        context.counter.increment('freshContentPage');
        status.gotoURL = ['a#nav-logo-sprites', 'random'];
        continue;
      }

      // @ts-ignore
      if (lastResponseCode === 503 || page.is500Page) {
        console.log('getting  503 pageId, Clicking 503 image');
        status.update('page503');
        context.counter.increment('page503');
        status.gotoURL = ['a img[src*="503.png"], a[href*="ref=cs_503_link"], a img[src*="error/500-title"]', 'random'];
        continue;
      }

      // @ts-ignore
      if (page.is400Page) {
        status.update('page400');
        context.counter.increment('page400');
        status.gotoURL = gotoInput.url;
        continue;
      }

      // @ts-ignore
      if (lastResponseCode === 404 || lastResponseCode === 410 || page.is400Page || (page.hasDogsofAmazon && !page.is500Page)) {
        status.update('otherBlock');
        context.counter.increment('otherBlock');
        continue;
      }

      // @ts-ignore
      if (page.hasCookieAcceptRequest && fillRateStrategies.acceptCookies) {
        // @ts-ignore
        console.log(`Checking for cookie accept request: ${page.hasCookieAcceptRequest}`);
        await helper.ifThereClickOnIt('#sp-cc-accept');
        console.log('Waiting for cookie modal to close, Done checking for cookie accept request');
        await new Promise(resolve => setTimeout(resolve, 1000));
      }

      // deal with zip
      // @ts-ignore
      if (!['NOZIP', 'CLEARZIP'].find(keyWord => zipcodes?.find(zipcode => zipcode === keyWord)) && !page.isPrimeVideo) {
        const { zipcode: zipcodeToUse, zipcodeIsSet } = await getZipCode();
        console.log(`Condition to try setting zipcode is: ${!zipcodeIsSet} + ${!status.hasTriedZipBefore} = ${!zipcodeIsSet && !status.hasTriedZipBefore} , ${nbZiptryouts}`);
        if (!zipcodeIsSet && !status.hasTriedZipBefore) {
          status.hasTriedZipBefore = true;
          const { needsReload, result } = await setZip(zipcodeToUse, page);
          if (needsReload) status.tryReload = true;
          status.hasTriedZipBefore = !!result;
          console.log(`Zipcode after: ${!!result}, ${result}, ${nbZiptryouts}`);
          continue;
        }
      } else if (zipcodes.includes('CLEARZIP') && status.hasNeverClearedStorage) {
        await noCookiesReloadPageOrSession({ pageOnly: true });
        continue;
      }

      // if (!Object.keys(status.expects).find(key => page[key])) {
      //   // we didn't land on an expected page
      //   console.log(`We are not on one of the expect pages ${JSON.stringify(Object.keys(status.expects))}, will try to navigate`);
      //   status.update('unexpectedPage');
      //   context.counter.increment('unexpectedPage');
      //   status.gotoURL = gotoInput.url; // navigate to the wanted page
      //   continue;
      // }

      // we are on expected page
      // deal with partial data on product page
      // await Promise.race([context.scrollToBottom({ maxScrolls: 4, waitTime: 2000 }), new Promise(resolve => setTimeout(resolve, 9000))]);
      let shouldHaveData = {};
      // @ts-ignore
      if (page.isProductPage) {
        shouldHaveData = await getShouldHaveData(gotoInput.url);

        // API append if variants exist and prodDetails expected, otherwise reload
        // @ts-ignore
        if ((!!parseInt(shouldHaveData.details, 10) && !page.hasProdDetails) || ALWAYS_APPEND_DATA) {
          // @ts-ignore
          if (page.hasVariants && fillRateStrategies.variantAPIAppendData) {
            console.log('append ------> Missing prodDetails when API history says it is expected, and variants exist.');
            status.update('partialData', 'append');
            context.counter.increment('partialData');
            await appendData();
            console.log('page update after append');
            continue;
          }
          // @ts-ignore
          if ((page.hasVariants && fillRateStrategies.variantReload) || (!page.hasVariants && fillRateStrategies.nonVariantReload)) {
            console.log('reload ------> Missing prodDetails when API history says it is expected, and variants exist.');
            status.update('partialData', 'reload');
            context.counter.increment('partialData');
            context.counter.set('refresh', 1);
            status.tryReload = true;
            continue;
          }
        }

        // deal with best seller ranks
        const { clientRecsList, reftag: reftagprefix } = await helper.checkAndReturnProp('[data-client-recs-list]', 'CSS', 'dataset') || {};

        // @ts-ignore
        if (clientRecsList?.length > page.bestSellerCount) {
          console.log('Error: MISSING_DATA: 50 bestSellers expected');
        }
        // @ts-ignore
        if (page.isBestSellerPage && page.bestSellerCount < 50 && clientRecsList?.length > page.bestSellerCount) {
          // @ts-ignore
          const ids = clientRecsList.slice(page.bestSellerCount);
          const { url } = await context.searchForRequest('list-grid-desktop', 'POST', 0, 10000) || {};

          while (ids.length > 0) {
            const chunk = ids.splice(0, 8);
            const body = {
              faceoutkataname: 'GeneralFaceout',
              ids: chunk.map(x => JSON.stringify(x)),
              indexes: chunk.map(x => Object.values(x.metadataMap)[0]),
              linkparameters: '',
              offset: '0',
              reftagprefix,
            };
            const apiGetBestSellers = await context.evaluate((bodyVal, urlVal) => fetch(urlVal, {
              method: 'POST',
              headers: {
                'x-amz-acp-params': 'tok=0;ts=123;rid=0',
                'Content-Type': 'application/json',
              },
              body: JSON.stringify(bodyVal),
            }).then(r => r.text()), body, url);

            await context.evaluate((apiGetBestSellersVal) => {
              const resultsElem = document.querySelector('[data-client-recs-list]');
              resultsElem.innerHTML += apiGetBestSellersVal;
            }, apiGetBestSellers);
          }
        }
      }

      await counter(page, lastResponseData, shouldHaveData);

      // missing  data retry strategies
      if (fillRateStrategies.missingDataRetry) {
        const missingErrors = Object.entries({
          // @ts-ignore
          [page.isProductPage]: {
            // @ts-ignore
            'prodDetails expected': parseInt(shouldHaveData.details, 10) && !page.hasProdDetails,
            // @ts-ignore
            'salesRank expected': fillRateStrategies.salesRankBadgeRetry && page.hasSalesRankBadge && !page.hasSalesRank,
            // @ts-ignore
            'aplus expected': fillRateStrategies.aplusRetry && !page.hasAplus && parseInt(shouldHaveData.aplus, 10),
            // @ts-ignore
            'product description expected': fillRateStrategies.hasProductDescription && !page.hasProductDescription && parseInt(shouldHaveData.description, 10),
          },
          // @ts-ignore
          [page.isSearchPage]: {
            // @ts-ignore
            'inline sponsored products expected': fillRateStrategies.hasInlineSponsoredProducts && !page.hasInlineSponsoredProducts,
          },
        // @ts-ignore
        }.true || {}).filter(([, val]) => val).map(([key]) => key);

        if (missingErrors.length > 0) {
          if (fillRateStrategies.hasInlineSponsoredProducts && missingErrors.includes('inline sponsored products expected')) {
            console.log('No inline sponsored products, trying to change the department');
            status.update('noInlineSponsored');
            context.counter.increment('noInlineSponsored');
            await helper.ifThereClickOnIt('#n a'); // ensure we are on the right department
            continue;
          }
          if (fillRateStrategies.inSessionRetries) {
          // clean cookie retry in session
            status.update('inSessionRetries', missingErrors[0]);
            context.counter.increment('inSessionRetries');
            console.log(`Starting in session retry due to those errors: ${JSON.stringify(missingErrors)}`);
            await noCookiesReloadPageOrSession({ pageOnly: false });
            continue;
          }
        }
      }
      context.counter.set('task', 1);
      status.isDone = true;
    }
    console.log(`The while loop terminated after ${iter} iterations with status:`, status.get());
    // throw errors
    // @ts-ignore
    const { error = '', displayed } = Object.values(status.retriesBeforeThrowing).find(({ displayed: dis = 0, max }) => dis === max) || {};
    console.log(`Error: ${error} due to being displayed: ${displayed} times`);
    if (error.includes('BLOCKED')) {
      await helper.throwError(`${error}, attempts=${displayed}`, { throwNBlock: true, blockedCode: lastResponseCode });
    }
    if (error.includes('MISSING')) {
      await helper.throwError(`${error}, attempts=${displayed}`, { throwNBlock: true, noThrowOnLast: true, treatLastXAsLast: 2 });
    }
  },
  dependencies: { helperModule: 'module:helpers/helpers' },
};
