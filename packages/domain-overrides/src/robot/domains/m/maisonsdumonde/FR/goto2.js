module.exports = {
  implements: 'navigation/goto2',
  parameterValues: {
    blockUnnecessaryRequests: [
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
    acceptCookiesCSSSelector: '#footer_tc_privacy_button_2',
    captchaSelectors: { GEETEST: "iframe[_src*='captcha'], iframe[src*='captcha']" },
    submitCaptchaButtonCSS: null,
    waitAfterNavObject: {
      wrongRedirectSelector: '',
      selector: '',
      selectorType: '',
      delay: null,
    },
    store: null,
    country: 'FR',
    domain: 'maisonsdumonde',
    schemaYAML: 'multiPages',
  },
};
