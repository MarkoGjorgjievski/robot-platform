module.exports = {
  implements: 'robots/san-antonio',
  parameterValues: {
    resultsTarget: 1,
    country: 'UK',
    loadedSelector: '#event-info-section',
    waitForSelectorToLoad: '#event-info-section',
    noResultsXPath: '//h1[contains(text(),"Denied")]',
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
    domain: 'axs',
  },
};
