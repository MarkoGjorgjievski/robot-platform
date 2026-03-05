module.exports = {
  implements: 'navigation/goto2',
  parameterValues: {
    blockUnnecessaryRequests: [
      '<font|stylesheet>',
    ],
    setBlockAds: true,
    setBypassCSP: true,
    timeout: 80000,
    setLoadAllResources: null,
    setLoadImages: null,
    setCssEnabled: null,
    applyIgnoreVBAndCookies: null,
    optTags: null,
    waitUntil: 'networkidle0',
    acceptCookiesCSSSelector: '.cmpboxbtn.cmpboxbtnyes.cmptxt_btn_yes',
    captchaSelectors: false,
    waitAfterNavObject: {
      wrongRedirectSelector: '',
      selector: '',
      selectorType: '',
      delay: null,
    },
    store: null,
    country: 'UK',
    domain: 'eventim',
    schemaYAML: 'singlePage',
  },
};
