module.exports = {
  implements: 'robots/san-antonio',
  parameterValues: {
    resultsTarget: null,
    country: 'NL',
    loadedSelector: 'body',
    waitForSelectorToLoad: null,
    noResultsXPath: '//h1[contains(text(),"404")]',
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
