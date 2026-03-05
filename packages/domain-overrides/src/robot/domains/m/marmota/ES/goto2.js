module.exports = {
  implements: 'navigation/goto2',
  parameterValues: {
    blockUnnecessaryRequests: [
    ],
    setBlockAds: false,
    setBypassCSP: true,
    setLoadAllResources: true,
    setLoadImages: true,
    setCssEnabled: true,
    applyIgnoreVBAndCookies: null,
    optTags: null,
    timeout: 60000,
    waitUntil: 'networkidle0',
    acceptCookiesCSSSelector: '.cc-allow',
    captchaSelectors: {},
    submitCaptchaButtonCSS: null,
    waitAfterNavObject: {
      wrongRedirectSelector: '',
      selector: '',
      selectorType: '',
      delay: null,
    },
    store: null,
    country: 'ES',
    domain: 'marmota',
    schemaYAML: 'multiPages',
  },
};
