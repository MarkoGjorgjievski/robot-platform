module.exports = {
  implements: 'robots/san-antonio',
  parameterValues: {
    resultsTarget: 1,
    country: 'IT',
    loadedSelector: 'html',
    waitForSelectorToLoad: 'html',
    noResultsXPath: '//h1[contains(text(),"No Results")]',
    accessDeniedXPath: '//h1[contains(text(),"Denied")]',
    URLTemplate: 'https://apigatewayb2cstore.vivaticket.com/api/Event/{id}/it/it-IT',
    zipcode: null,
    storeID: null,
    useGoto2: true,
    schemaYAML: 'singlePage',
    arrayOfInputFieldNamesToAdd: null,
    paginate: {
      stopConditionSelectorOrXpath: null,
      nextLink: {
        nextLinkSelectorOrXpath: null,
        mutationSelectorOrXpath: null,
        spinnerSelectorOrXpath: null,
        nextLinkTimeout: null,
      },
      openSearchDefinition: {
        template: 'https://apigatewayb2cstore.vivaticket.com/api/Events/Search/{pageNB}/it/it-IT?{KEYWORD}',
        pageStartNb: 1,
        indexOffset: null,
        pageOffset: null,
        pageIndexMultiplier: null,
      },
    },
    domain: 'vivaticket',
  },
};
