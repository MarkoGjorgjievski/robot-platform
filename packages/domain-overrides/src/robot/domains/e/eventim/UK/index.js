module.exports = {
  implements: 'robots/san-antonio',
  parameterValues: {
    resultsTarget: null,
    blockUnnecessaryRequests: [
      '<font|stylesheet>',
    ],
    country: 'UK',
    loadedSelector: 'main#main.main-content',
    waitForSelectorToLoad: '.search-result-content[role="list"]',
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
    },
    domain: 'eventim',
  },
};
