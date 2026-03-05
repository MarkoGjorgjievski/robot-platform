module.exports = {
  implements: 'navigation/goto2',
  parameterValues: {
    blockUnnecessaryRequests: [
      // '<xhr|script|font|stylesheet>',
    ],
    rawOptions: {},
    setBlockAds: false,
    setBypassCSP: false,
    setLoadAllResources: true,
    setLoadImages: true,
    setCssEnabled: true,
    applyIgnoreVBAndCookies: null,
    optTags: null,
    timeout: 10000,
    waitUntil: 'networkidle0',
    // eslint-disable-next-line no-useless-escape
    acceptCookiesCSSSelector: 'button[data-enzyme-id="BannerAcceptAll"]',
    captchaSelectors: { PERIMETERX: 'div[id="px-captcha"]' },
    // captchaSelectors: { PERIMETERX: 'iframe[title="Human verification challenge"]' },
    submitCaptchaButtonCSS: null,
    waitAfterNavObject: {
      wrongRedirectSelector: '',
      selector: '',
      selectorType: '',
      delay: null,
    },
    store: null,
    country: 'UK',
    domain: 'wayfair',
    schemaYAML: 'singlePage',
  },
};
