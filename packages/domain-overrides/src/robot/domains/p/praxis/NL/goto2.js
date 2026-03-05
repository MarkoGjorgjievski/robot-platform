module.exports = {
  implements: 'navigation/goto2',
  parameterValues: {
    blockUnnecessaryRequests: [
    ],
    setBlockAds: true,
    setBypassCSP: true,
    setLoadAllResources: null,
    setLoadImages: null,
    setCssEnabled: null,
    applyIgnoreVBAndCookies: null,
    optTags: null,
    timeout: 60000,
    waitUntil: 'networkidle0',
    acceptCookiesCSSSelector: 'button[data-gtm-id="consent_marketing"]',
    captchaSelectors: {},
    submitCaptchaButtonCSS: null,
    waitAfterNavObject: {
      wrongRedirectSelector: '',
      selector: '',
      selectorType: '',
      delay: null,
    },
    store: null,
    country: 'NL',
    domain: 'praxis',
    schemaYAML: 'multiPages',
  },
};
