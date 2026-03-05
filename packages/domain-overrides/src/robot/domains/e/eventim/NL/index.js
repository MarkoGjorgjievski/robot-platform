module.exports = {
  implements: 'robots/san-antonio',
  parameterValues: {
    resultsTarget: '1',
    country: 'NL',
    loadedXpath: null, // '//*[@id="main"][not(./section[@data-c]//div[contains(text(),"abgesagt") or contains(text(), "cancelled")])][not(./section/h2[contains(text(), "not found") or contains(text(), "nicht gefunden")])]',
    waitForSelectorToLoad: '.search-result-content[role="list"]',
    noResultsXPath: '//div[contains(text(), "cancelled") or contains(text(),"abgesagt")] | //h2[contains(text(), "not found") or contains(text(), "nicht gefunden")]',
    accessDeniedXPath: '//h1[contains(text(),"Denied")]',
    URLTemplate: null,
    zipcode: null,
    storeID: null,
    useGoto2: true,
    schemaYAML: 'multiPages',
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
    domain: 'eventim',
  },
};
