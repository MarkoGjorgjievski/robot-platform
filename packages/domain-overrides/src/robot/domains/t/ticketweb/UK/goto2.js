module.exports = {
  implements: 'navigation/goto2',
  parameterValues: {
    blockUnnecessaryRequests: [
      '<xhr|script|font|stylesheet>',
    ],
    setBlockAds: false,
    setBypassCSP: false,
    setLoadAllResources: true,
    setLoadImages: true,
    setCssEnabled: true,
    applyIgnoreVBAndCookies: null,
    optTags: null,
    timeout: 60000,
    waitUntil: 'networkidle0',
    acceptCookiesCSSSelector: null,
    captchaSelectors: {},
    waitAfterNavObject: {
      wrongRedirectSelector: '',
      selector: '',
      selectorType: '',
      delay: null,
    },
    store: null,
    country: 'UK',
    domain: 'ticketweb',
    schemaYAML: 'singlePage',
  },
};
