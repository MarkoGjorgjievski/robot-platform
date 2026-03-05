module.exports = {
  implements: 'robots/san-antonio',
  parameterValues: {
    resultsTarget: null,
    country: 'IT',
    loadedSelector: 'body',
    waitForSelectorToLoad: null,
    noResultsXPath: '//*[@id="hero-content"]',
    accessDeniedXPath: '//h1[contains(text(),"Denied")]',
    URLTemplate: null,
    zipcode: null,
    storeID: null,
    useGoto2: true,
    schemaYAML: 'singlePage',
    paginate: {
      stopConditionSelectorOrXpath: null,
      nextLink: {
        nextLinkSelectorOrXpath: null,
        mutationSelectorOrXpath: null,
        spinnerSelectorOrXpath: null,
        nextLinkTimeout: null,
      },
      openSearchDefinition: {
        template: null,
        pageStartNb: null,
        indexOffset: null,
        pageOffset: null,
        pageIndexMultiplier: null,
      },
    },
    domain: 'ticketmaster',
  },
};
