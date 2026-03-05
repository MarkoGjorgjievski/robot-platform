module.exports = {
  implements: 'navigation/goto2',
  parameterValues: {
    blockUnnecessaryRequests: [
      '<xhr|script|font|stylesheet>',
    ],
    setBlockAds: false,
    setBypassCSP: true,
    setLoadAllResources: true,
    setLoadImages: true,
    setCssEnabled: true,
    applyIgnoreVBAndCookies: false,
    optTags: null,
    gotoOptionTimeout: 10000,
    waitUntil: 'networkidle0',
    acceptCookiesCSSSelector: null,
    captchaSelectors: false,
    waitAfterNavObject: {
      wrongRedirectSelector: '',
      selector: '',
      selectorType: '',
      delay: null,
    },
    store: null,
    country: 'IT',
    domain: 'vivaticket',
    schemaYAML: 'singlePage',
  },
};
