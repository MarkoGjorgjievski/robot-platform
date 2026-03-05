module.exports = {
  implements: 'navigation/goto2',
  parameterValues: {
    blockUnnecessaryRequests: [
    ],
    setBlockAds: true,
    setBypassCSP: false,
    setLoadAllResources: true,
    setLoadImages: true,
    setCssEnabled: true,
    applyIgnoreVBAndCookies: null,
    optTags: null,
    timeout: 60000,
    waitUntil: 'networkidle0',
    acceptCookiesCSSSelector: '#coiPage-1 > div.coi-banner__page-footer > button.coi-banner__accept',
    captchaSelectors: {},
    submitCaptchaButtonCSS: null,
    waitAfterNavObject: {
      wrongRedirectSelector: '',
      selector: '',
      selectorType: '',
      delay: null,
    },
    store: null,
    country: 'SE',
    domain: 'elgigante_se',
    schemaYAML: 'singlePage',
  },
};
