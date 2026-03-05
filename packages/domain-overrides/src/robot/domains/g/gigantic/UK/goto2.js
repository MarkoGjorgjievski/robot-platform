module.exports = {
  implements: 'navigation/goto2',
  parameterValues: {
    blockUnnecessaryRequests: [
      '<xhr|script|font|stylesheet>',
    ],
    setBlockAds: true,
    setBypassCSP: true,
    setLoadAllResources: false,
    setLoadImages: false,
    setCssEnabled: false,
    applyIgnoreVBAndCookies: false,
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
    domain: 'gigantic',
    schemaYAML: 'singlePage',
  },
};
