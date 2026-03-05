module.exports = {
  implements: 'robots/san-antonio',
  parameterValues: {
    country: 'FR',
    store: 'mon-liquide',
    loadedSelector: 'div#columns',
    noResultsXPath: '//span[@class="eo_notemoyenne"][not(div)]',
    URLTemplate: 'https://mon-liquide.fr/recherche?controller=search&orderby=position&orderway=desc&search_query={searchTerms}&submit_search=',
    zipcode: null,
    storeID: null,
    useGoto2: true,
    append: {
      combinationsFromController: {
        xpath: '//script[@type="text/javascript"][not(@src)][contains(text(), "var combinations =")]',
        regex: 'var combinationsFromController = (.*);',
      },
    },
    schemaYAML: 'singlePage',
    paginate: {
      stopConditionSelectorOrXpath: null,
      nextLink: {
        nextLinkSelectorOrXpath: 'li.active.current + li a',
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
    domain: 'mon-liquide',
    resultsTarget: '1',
  },
};
