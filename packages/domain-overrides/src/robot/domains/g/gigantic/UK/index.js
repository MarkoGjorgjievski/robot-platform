module.exports = {
  implements: 'robots/san-antonio',
  parameterValues: {
    resultsTarget: null,
    country: 'UK',
    loadedSelector: 'body',
    waitForSelectorToLoad: null,
    noResultsXPath: '//h1[contains(text(),"404")]',
    accessDeniedXPath: '//h1[contains(text(),"Denied")]',
    loadingTimeout: 5000,
    URLTemplate: null,
    zipcode: null,
    storeID: null,
    useGoto2: true,
    schemaYAML: 'singlePage',
    paginate: {
      stopConditionSelectorOrXpath: null,
      nestedPagination: {
        nextDepthURLFieldName: null,
        paginate: null,
      },
      nextLink: {
        nextLinkSelectorOrXpath: null,
        mutationSelectorOrXpath: null,
        spinnerSelectorOrXpath: null,
        nextLinkTimeout: null,
        waitForXpath: null,
      },
      openSearchDefinition: {
        template: null,
        pageStartNb: null,
        indexOffset: null,
        pageOffset: null,
        pageIndexMultiplier: null,
      },
    },
    domain: 'gigantic',
  },
};
