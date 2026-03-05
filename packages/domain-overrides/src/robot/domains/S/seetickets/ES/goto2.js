module.exports = {
  implements: 'navigation/goto2',
  parameterValues: {
    blockUnnecessaryRequests: [
      '<xhr|script|font|stylesheet>',
    ],
    setBlockAds: true,
    setBypassCSP: true,
    setLoadAllResources: null,
    setLoadImages: null,
    setCssEnabled: null,
    applyIgnoreVBAndCookies: null,
    optTags: null,
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
    country: 'ES',
    domain: 'seetickets',
    schemaYAML: 'singlePage',
  },
};
