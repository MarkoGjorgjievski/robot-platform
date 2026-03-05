module.exports = {
  implements: 'robots/san-antonio',
  parameterValues: {
    resultsTarget: '300',
    country: 'SE',
    store: 'snusbolaget',
    loadedSelector: '.row',
    noResultsXPath: '//span[contains(text(), "0 st")] | //h1[contains(text(),"Ojdå! Tyvärr kunde inte sidan hittas.")]',
    URLTemplate: 'https://www.snusbolaget.se/sok/?q={searchTerms}',
    zipcode: null,
    storeID: null,
    useGoto2: true,
    schemaYAML: 'multiPages',
    paginate: {
      stopConditionSelectorOrXpath: null,
      nextLink: {
        nextLinkSelectorOrXpath: 'a.disabled.pagination-btn + a',
        mutationSelectorOrXpath: null,
        spinnerSelectorOrXpath: null,
        nextLinkTimeout: null,
      },
    },
    domain: 'snusbolaget',
  },
};
