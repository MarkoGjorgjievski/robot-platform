module.exports = {
  implements: 'navigation/goto2',
  parameterValues: {
    blockUnnecessaryRequests: [
    ],
    setBlockAds: true,
    setBypassCSP: true,
    setLoadAllResources: null,
    setLoadImages: null,
    setCssEnabled: true,
    applyIgnoreVBAndCookies: null,
    optTags: null,
    timeout: 60000,
    waitUntil: 'networkidle0',
    // acceptCookiesCSSSelector: null,
    captchaSelectors: {},
    submitCaptchaButtonCSS: null,
    waitAfterNavObject: {
      wrongRedirectSelector: '',
      selector: '',
      selectorType: '',
      delay: null,
    },
    store: null,
    country: 'SA',
    domain: 'ikea',
    schemaYAML: 'singlePage',
  },
};
