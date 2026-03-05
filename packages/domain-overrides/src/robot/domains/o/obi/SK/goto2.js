module.exports = {
  implements: 'navigation/goto2',
  parameterValues: {
    blockUnnecessaryRequests: ['<font|stylesheet>'],
    setBlockAds: true,
    setBypassCSP: true,
    setLoadAllResources: true,
    setLoadImages: true,
    setCssEnabled: null,
    applyIgnoreVBAndCookies: null,
    optTags: null,
    timeout: 60000,
    waitUntil: 'networkidle0',
    acceptCookiesCSSSelector:
      'button.disc-cp-modal__button-primary.js-disc-cp-accept-all',
    captchaSelectors: {},
    submitCaptchaButtonCSS: null,
    waitAfterNavObject: {
      wrongRedirectSelector: '',
      selector: '',
      selectorType: '',
      delay: null,
    },
    store: null,
    country: 'SK',
    domain: 'obi',
    schemaYAML: 'multiPages',
  },
};
