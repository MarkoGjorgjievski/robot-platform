module.exports = {
  implements: 'navigation/goto2',
  parameterValues: {
    blockUnnecessaryRequests: [
      '<xhr|script|font|stylesheet>',
    ],
    setBlockAds: true,
    setBypassCSP: true,
    setLoadAllResources: true,
    setLoadImages: true,
    setCssEnabled: true,
    applyIgnoreVBAndCookies: false,
    optTags: null,
    gotoOptionTimeout: 10000,
    waitUntil: 'networkidle0',
    acceptCookiesCSSSelector: '#onetrust-accept-btn-handler',
    captchaSelectors: false,
    store: null,
    country: 'UK',
    domain: 'axs',
    schemaYAML: 'singlePage',
  },
};
