module.exports = {
  implements: 'navigation/goto2',
  parameterValues: {
    blockUnnecessaryRequests: [
      // '<font|stylesheet>',
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
    // both on old and new skin
    acceptCookiesCSSSelector: 'div[id*="tc-privacy-wrapper"] button[aria-label*="Accepter"]',
    captchaTimeout: 6000,
    captchaSelectors: { HCAPTCHA: '#captcha-form iframe' },
    submitCaptchaButtonCSS: null,
    waitAfterNavObject: {
      wrongRedirectSelector: '',
      selector: '',
      selectorType: '',
      delay: null,
    },
    store: null,
    country: 'FR',
    domain: 'cdiscount',
    schemaYAML: 'multiPages',
  },
};
