module.exports = {
  implements: 'robots/san-antonio',
  parameterValues: {
    resultsTarget: null,
    country: 'HK',
    loadedSelector: '.container #detail, .tmb_row_list_blk',
    waitForSelectorToLoad: null,
    noResultsXPath: '//h1[contains(text(),"404")]',
    accessDeniedXPath: '//h1[contains(text(),"Denied")]',
    orderedSelectorsToClickOn: [],
    loadingTimeout: 5000,
    URLTemplate: null,
    zipcode: null,
    storeID: null,
    useGoto2: true,
    schemaYAML: 'singlePage',
    mergeType: 'APPEND',
    maxScrolls: 3,
    arrayOfInputFieldNamesToAdd: null,
    paginate: {
      stopConditionSelectorOrXpath: null,
      nestedPagination: {
        // allows to have nested pagination for the same page - multiple levels of pagination
        nextDepthURLFieldName: null,
        paginate: null,
      },
      nextLink: {
        // selector for the element where to click to visit next page
        nextLinkSelectorOrXpath: null,
        mutationSelectorOrXpath: null,
        spinnerSelectorOrXpath: null,
        nextLinkTimeout: null,
        waitForXpath: null,
      },
      infiniteScroll: {
        maxScrolls: null,
        stopXPath: null,
        waitTime: null,
      },
      openSearchDefinition: {
        template: null,
        pageStartNb: null,
        indexOffset: null,
        pageOffset: null,
        pageIndexMultiplier: null,
        // properties that helps to handle different pagination strategies
      },
    },
    domain: 'timable',
  },
};
