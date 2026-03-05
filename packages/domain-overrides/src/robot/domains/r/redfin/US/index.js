module.exports = {
  implements: 'robots/san-antonio',
  parameterValues: {
    resultsTarget: '1',
    country: 'US',
    loadedSelector: '#content[data-react-server-content] .belowTheRail',
    waitForSelectorToLoad: '.theRail section',
    noResultsXPath: '//h2[contains(text(),"Oops… lost that one.")]',
    accessDeniedXPath: '//*[@id="rf_unblock"] | //*[contains(text(),"be a robot")]',
    URLTemplate: 'https://www.redfin.com/{State}/{randomSlug}/home/{ID}',
    maxScrolls: 6,
    orderedSelectorsToClickOn: [
      '[id*="propertyHistory"] .sectionBottomLink',
    ],
    zipcode: null,
    storeID: null,
    useGoto2: true,
    schemaYAML: 'multiplePage',
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
    domain: 'redfin',
  },
};
