module.exports = {
  implements: 'navigation/goto2',
  parameterValues: {
    // xhr/javascript must be enabled for js/xhr pagination to work
    blockUnnecessaryRequests: [
      '<font|stylesheet>',
    ],
    setBlockAds: true,
    setBypassCSP: true,
    setLoadAllResources: null,
    setLoadImages: null,
    setCssEnabled: null,
    applyIgnoreVBAndCookies: null,
    // set alibaba to en_US/ChineseYuan display to circumvent any geolocation
    optTags: '"cookie_jar":[{"name":"sc_g_cfg_f","value":"sc_b_site=CN&sc_b_currency=CNY&sc_b_locale=en_US"}]',
    timeout: 60000,
    waitUntil: 'networkidle0',
    acceptCookiesCSSSelector: null,
    captchaSelectors: {},
    submitCaptchaButtonCSS: null,
    waitAfterNavObject: {
      wrongRedirectSelector: '',
      selector: '',
      selectorType: '',
      delay: null,
    },
    store: null,
    country: 'CN',
    domain: 'quanu',
    schemaYAML: 'multiPages',
  },
};
