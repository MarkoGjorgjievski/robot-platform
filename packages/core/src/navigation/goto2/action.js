/**
 *
 * @param { { id: any } } inputs
 * @param { { domain: string, prefix?: string, suffix?: string, url?: string } } parameters
 * @param { ImportIO.IContext } context
 * @param { { } } dependencies
 */

const { preCompileFunctions } = require('../navigationHelperLibrary');

module.exports = {
  parameters: [
    {
      name: 'blockUnnecessaryRequests',
      description: 'Array of request matching pattern that will be blocked. Having "xhr" inside can prevent fetch calls',
      default: [
        '<xhr|script|font|stylesheet>',
      ],
      type: 'array',
      records: 'regex',
    },
    {
      name: 'setBlockAds',
      description: 'Prevents ads from loading, sometimes it also prevents 3rd party library from loading as well',
      default: true,
      type: 'boolean',
    },
    {
      name: 'setBypassCSP',
      description: 'Prevents the csp from activating',
      default: true,
      type: 'boolean',
    },
    {
      name: 'setLoadAllResources',
      description: 'Tries to load all the possible ressources on the page',
      default: false,
      type: 'boolean',
    },
    {
      name: 'setLoadImages',
      description: 'Tries to load all the possible images on the page',
      default: false,
      type: 'boolean',
    },
    {
      name: 'setCssEnabled',
      description: 'Tries to load all the possible css on the page',
      default: false,
      type: 'boolean',
    },
    {
      name: 'acceptCookiesCSSSelector',
      description: 'Specify the selector to click on to accept the cookies',
      default: '',
      type: 'css',
    },
    {
      name: 'timeout',
      description: 'Specifies all the timeouts for the function',
      default: 60000,
      type: 'time',
    },
    {
      name: 'waitForCookiesSelectorTimeout',
      description: 'Specify how long to wait to give for the cookie selectors to load.',
      default: 3000,
      advanced: true,
      type: 'time',
    },
    {
      name: 'force200',
      description: 'Override the goto HTTP response code to 200',
      default: false,
      advanced: true,
      type: 'boolean',
    },
    {
      name: 'gotoRetries',
      description: 'The maximum number of goto to perform. If 0 the goto is disabled.',
      type: 'number',
      advanced: true,
      default: 1,
    },
    {
      name: 'firstRequestTimeout',
      description: 'How long to wait before timing out the goto even if the load event hasn\'t yet fired.',
      type: 'time',
      advanced: true,
      default: 31000,
    },
    {
      name: 'optTags',
      description: 'List of tags comma separated, without the opt tags delimiters',
      default: null,
      type: 'string',
      advanced: true,
    },
    {
      name: 'retryGotoUntilLoadedCSSorXpath',
      description: 'If the loadedCSS/LoadedXpath doesn\'t match the goto will be attempted again',
      default: false,
      advanced: true,
      type: 'boolean',
    },
    {
      name: 'captureRequests',
      description: 'Required setting if the search request function is used.',
      default: false,
      advanced: true,
      type: 'boolean',
    },
    {
      name: 'useFetch',
      description: 'Specify if the goto should be done using a fetch + document overwrite',
      default: false,
      advanced: true,
      type: 'boolean',
    },
    {
      name: 'browserFetch',
      description: 'Specify if the fetch overwrite should be done from the browser front end or from extractorContext back end.',
      default: false,
      advanced: true,
      type: 'boolean',
    },
    {
      name: 'fromAboutBlank',
      description: 'Specify we should navigate to about:blank before doing the fetch call',
      default: true,
      advanced: true,
      type: 'boolean',
    },
    {
      name: 'useLambda',
      description: 'Specifyif the backend fetch should use the lambda verison',
      default: 'None',
      advanced: true,
      type: 'enum',
      records: ['Windmill', 'AWS', 'None'],
    },
    {
      name: 'injectedID',
      description: 'Specify an id to inject the element with for an easier xpath targetting',
      default: null,
      advanced: true,
      type: 'string',
    },
    {
      name: 'rawOptions',
      description: 'A key value pair object of gotoOptions passed directly to the goto function',
      default: {},
      type: 'object',
      advanced: true,
    },
    {
      name: 'turnOffTableNormalize',
      description: 'If this isn\'t turned off. The engine will normalise an HTML table to account for the row-span class',
      default: false,
      advanced: true,
      type: 'boolean',
      hide: false,
    },
    {
      name: 'captchaSelectors',
      description: 'Object specifying the CSS selectors for each supported captcha type',
      default: {},
      type: 'object',
      advanced: true,
      records: [
        { HCAPTCHA: 'css' }, // 'form#challenge-form'
        { GEETEST: 'css' }, // 'iframe[src^="https://geo.captcha-delivery.com/captcha/"]'
        { RECAPTCHA: 'css' }, // 'div.re-captcha'
        { PERIMETERX: 'css' }, // '#px-captcha iframe[style~="block;"]'
        {
          IMAGECAPTCHA: {
            type: 'object',
            optional: true,
            records: [{ inputElement: 'css', imageElement: 'css' }],
          },
        },
        {
          NAVER: {
            type: 'object',
            optional: true,
            records: [{ inputElement: 'css', imageElement: 'css', questionElement: 'css' }],
          },
        },
        { FUNCAPTCHA: 'css' },
        { CLOUDFLARE: 'css' },
      ],
    },
    {
      name: 'sumbitCaptchaOrderedActions',
      default: [],
      description: 'Ordered list of actions to perform directly after the captcha solver is called. Supply an array of objects describing the actions or a single selector to simply perform a click. Sometimes the captcha needs some extra actions before being completed like clicking on submit button.',
      records: [{
        action: {
          type: 'object',
          description: 'Object specifying elements important to the type of action to perfrom',
          records: [
            {
              selectorOrXpath:
              {
                type: 'cssOrXpath',
                description: 'Xpath or CSS selector to identify the key element of the action. If nothing else is provided it will perform a click on the corresponding element.',
              },
            },
            {
              inputValue:
              {
                type: 'string',
                description: 'The value used for the action. If attributeToSet is also provided it will be the value for that attribute. If it is not provided the action will try to type the value inside the element targeted by selectorOrXpath. Only works for editable elements like inputs or text areas.',
                optional: true,
              },
            },
            {
              selectorOrXpathToWaitFor:
              {
                type: 'cssOrXpath',
                description: 'Xpath or CSS to wait for at the end of the action to validate that it was successfull.',
                optional: true,
              },
            },
            {
              attributeToSet:
              {
                type: 'string',
                description: 'Name of an attribute to modify. The subject dom element is targeted by selectorOrXpath and the value to set the attribute to is specified by inputValue',
                optional: true,
              },
            },
            {
              scrollFromSelectorOrXpath:
              {
                type: 'cssOrXpath',
                description: 'Xpath or CSS selector identifying the top element that the scrolling will start from.',
                optional: true,
              },
            },
            {
              stopXPath:
              {
                type: 'cssOrXpath',
                description: 'Xpath or CSS selector specifying a matching condition to interrupt the scrolling early.',
                optional: true,
              },
            },
            {
              doNotScrollXpath:
              {
                type: 'cssOrXpath',
                description: 'Xpath or CSS selector representing elements which should not be scrolled.',
                optional: true,
              },
            },
            {
              steps:
              {
                type: 'number',
                description: 'Value controlling the speed of the scrolling. A value of 1 is extremly slow while a value of 30-40 is ok.',
                optional: true,
              },
            },
            {
              wait:
              {
                type: 'time',
                description: 'If provided - alone or with other attributes - will do a wait at the end of the action, if selectorToWaitFor is also provided, it controls the wait for that selector',
                optional: true,
              },
            },
            {
              waitDisappear:
              {
                type: 'boolean',
                description: 'If provided - never alone - will wait for the specified selector to disappear',
                optional: true,
                default: false,
              },
            },
          ],
        },
      }, 'cssOrXpath'],
    },
    {
      name: 'submitCaptchaButtonCSS',
      description: 'Sometimes the captcha needs to be submitted after being solved',
      default: '',
      type: 'css',
      advanced: true,
      hide: true,
    },
    {
      name: 'maxCaptcha',
      description: 'Controls the total number of attempts to solve a captcha before returning blocked',
      type: 'number',
      advanced: true,
      default: 3,
      hide: true,
    },
    {
      name: 'captchaTimeout',
      description: 'Controls the waitForCaptcha and waitForNavigation',
      default: 5000,
      advanced: true,
      type: 'time',
      hide: true,
    },
    {
      name: 'timeoutOffset',
      description: 'Controls a static timeout offset for repeated captcha',
      default: 1000,
      advanced: true,
      type: 'time',
      hide: true,
    },
    {
      name: 'waitUntil',
      description: 'Specify the criteria to trigger a timeout when the goto is performed, valid values are "networkidle0" or "load"',
      default: 'networkidle0',
      type: 'enum',
      records: ['networkidle0', 'load'],
      advanced: true,
      hide: true,
    },
    {
      name: 'applyIgnoreVBAndCookies',
      description: 'If true, will add options to ignore the virtual browser and the cookies',
      default: false,
      type: 'boolean',
      advanced: true,
      hide: true,
    },
    {
      name: 'waitAfterNavObject',
      description: 'Object specifying the logic to bypass cloudflare type of waiting.',
      advanced: true,
      default: {
        wrongRedirectSelector: '',
        selector: '',
        selectorType: '',
        delay: 0,
      },
      type: 'object',
      hide: true,
      records: [
        {
          wrongRedirectSelector: {
            type: 'css',
            description: 'Selector identifying if the captha redirected towards an unwanted page. If it is the case the extraction',
          },
        },
        {
          selector: {
            type: 'css',
            description: 'Selector identifying if we landed on a cloudflare type of waiting',
          },
        },
        {
          selectorType: {
            type: 'enum',
            description: 'CSS or XPATH for the two specified selectors.',
            records: ['CSS', 'XPATH'],
          },
        },
        {
          delay: {
            type: 'time',
            description: 'Waiting time in ms before doing anything',
            optional: true,
          },
        }],
    },
  ],
  inputs: [
  ],
  dependencies: {
    helperModule: 'module:helpers/helpers',
    captchaSolversModule: 'module:captchas/captchaSolvers',
    gotoSolver: 'action:captchas/gotoWithSolver',
    fetchGoto: 'action:navigation/fetchGoto',
  },
  tempPath: '',
  // @ts-ignore
  get path() {
    const actionjsPath = preCompileFunctions.getRobotTemplateName();
    return this.tempPath || `${actionjsPath}/domains/\${domain[0:1]}/\${domain}/\${country}/goto2`;
  },
  // @ts-ignore
  set path(val) {
    this.tempPath = val;
  },
  implementation: async (inputs, parameters, context, dependencies) => {
    const { url, loadedXpath, loadedSelector, loadingTimeout = 5000 } = inputs;
    const { helperModule: { Helpers }, captchaSolversModule: { Solvers }, gotoSolver, fetchGoto } = dependencies;
    const helper = new Helpers(context);
    const defaultParams = {
      captureRequests: false,
      blockUnnecessaryRequests: false,
      setBlockAds: true,
      setBypassCSP: true,
      setLoadAllResources: false,
      setLoadImages: false,
      setCssEnabled: false,
      applyIgnoreVBAndCookies: false,
      submitCaptchaButtonCSS: '',
      optTags: '',
      useFetch: false,
      waitUntil: 'networkidle0',
      acceptCookiesCSSSelector: '',
      waitForCookiesSelectorTimeout: 3000,
      captchaSelectors: {}, // keep empty object if no captchas, otherwise build like so: { captchaType1: captchaSel, ...}
      waitAfterNavObject: {}, // object to handle cloudflare type of wait
      firstRequestTimeout: 31000,
      timeout: 60000, // controls the goto timeout
      captchaTimeout: 5000, // controls the waitForCaptcha and waitForNavigation
      timeoutOffset: 1000, // controls a static timeout offset for repeated captcha
      isCaptchaInNestedIframe: false, // deprecated
      validPageSelector: '', // specify a selector to interrupt the captcha solver
      maxCaptcha: 3, // controls the total number of attempts to solve a captcha before returning blocked
      hardBlockChecks: null, // specify clear text on the page that if found the whole extraction is stopped and marked as blocked, can cause issues if set
      userAgent: '',
      force200: false,
      sumbitCaptchaOrderedActions: [], // extra actions to do at the end
      retryGotoUntilLoadedCSSorXpath: false, // If the loadedCSS/LoadedXpath doesn't match the goto will be attempted again
      rawOptions: {},
      turnOffTableNormalize: false, // does nothin if false
      browserFetch: false,
      useLambda: 'None',
      antiCaptchaOptions: { type: ['GEETEST', 'HCAPTCHA', 'RECAPTCHA', 'PERIMETERX', 'IMAGECAPTCHA', 'NAVER', 'FUNCAPTCHA'] },
      fromAboutBlank: true,
      injectedID: null,
      gotoRetries: 1, // controls the number of retries for the goto
    };
    const params = { ...defaultParams, ...parameters, ...(inputs.goto2 || {}) };
    const {
      blockUnnecessaryRequests, firstRequestTimeout, setBypassCSP, setBlockAds, setLoadAllResources, setLoadImages, setCssEnabled, captureRequests,
      applyIgnoreVBAndCookies, captchaSelectors: captchaSelectorsRaw,
      waitUntil, timeout, force200, rawOptions, gotoRetries, useFetch, retryGotoUntilLoadedCSSorXpath,
      acceptCookiesCSSSelector, waitForCookiesSelectorTimeout,
    } = params;

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

    const optTagsString = await helper.make_opt_tags(params);

    const newGoto2 = {
      url: `${url}${optTagsString}`,
      ...params,
      captchaSelectors: await Solvers.getSolvers(captchaSelectorsRaw || {}),
      gotoOptions: {
        firstRequestTimeout, waitUntil, ignore_vb: applyIgnoreVBAndCookies, timeout, gotoTimeout: timeout, force200, ...rawOptions,
      },
      inputs,
    };

    let iter = 1;
    let gotoComplete = false;
    let gotoError;
    const fixedGotoRetries = gotoRetries == null ? 1 : gotoRetries;
    while (!gotoComplete && iter <= fixedGotoRetries) {
      iter += 1;
      try {
        if (useFetch) await fetchGoto({ inputs, options: newGoto2 });
        else await gotoSolver({ inputs, options: newGoto2 });
        // eslint-disable-next-line no-await-in-loop
        // await helper.gotoWithCaptchaSolver(destinationURL, newGoto2);
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
    if (iter > fixedGotoRetries && gotoError) throw new Error(gotoError);

    if (acceptCookiesCSSSelector) await helper.ifThereClickOnIt(acceptCookiesCSSSelector, waitForCookiesSelectorTimeout);
    return newGoto2;
  },
};
