/**
 *
 * @param { { id: string, RPC: string, SKU: string, URL: string, keywords: string, brands: string, UPC: string, resultsTarget: any, zipcode: string, storeID: string } } inputs
 * @param { { store: string, country: string, zipcode: string, storeID: string, domain: string } } parameters
 * @param { ImportIO.IContext } context
 * @param { { paginate: ImportIO.Action, extract: ImportIO.Action } } dependencies
 */

module.exports = {
  parameters: [
    {
      name: 'loadedXpath',
      type: 'xpath',
      default: '',
      description: 'Xpath selector to tell us the page has loaded correctly. If loadedSelector is also provided only loadedXpath will be considered.',
    },
    {
      name: 'noResultsXPath',
      type: 'xpath',
      default: '//h1[contains(text(),"404")]',
      description: 'XPath to tell us the page has loaded but does not contain any valid result.',
    },
    {
      name: 'accessDeniedXPath',
      type: 'xpath',
      description: 'XPath to tell us the page has loaded but is displaying an xpath showing a block.',
      default: '//h1[contains(text(),"Denied")]',
    },
    {
      name: 'loadingTimeout',
      type: 'time',
      description: 'Waiting time for loaded xpath and no result xpath',
      default: 5000,
    },
    {
      name: 'waitForSelectorToLoad',
      type: 'css',
      default: '',
      description: 'CSS selector that we want to take the time to wait for.',
    },
    {
      name: 'URLTemplate',
      type: 'string',
      description: 'Template specifying how the url should be created by replacing and encoding inputs specified by their name in curly braces - example: https://domain.com/{pageID}',
      optional: true,
    },
    {
      name: 'resultsTarget',
      description: 'The target number of results needed before stopping the extraction.',
      type: 'number',
      default: 1,
    },
    {
      name: 'orderedSelectorsToClickOn',
      type: 'array',
      description: 'Ordered list of selectors - CSS or Xpath - to click on before extraction. i.e. show more, close overlay, more infos...',
      default: [],
      records: ['cssOrXpath'],
    },
    {
      name: 'arrayOfInputFieldNamesToAdd',
      description: 'A list of all the field names from the inputs or from the previous nested pagination level to add to the output, you can pass in objects to rename the field i.e. ["fieldName1", {"fieldName2": "newName2"}, "fieldName3", ...]',
      type: 'array',
      default: [],
      records: ['string', 'object'],
    },
    {
      name: 'zipcode',
      description: 'Value used to set the location',
      type: 'string',
      optional: true,
      default: '',
    },
    {
      name: 'maxScrolls',
      description: 'Number of scroll retries done when landing on a page to try to reach the bottom',
      type: 'number',
      default: 1,
    },
    {
      name: 'bypassExtract',
      description: 'Turn it on to avoid calling context.extract()',
      type: 'boolean',
      default: false,
    },
    {
      name: 'setZipCode',
      description: 'A speciliazed serie of actions to set a zipcode on a page.',
      type: 'object',
      advanced: true,
      default: {
        checkZipCodeSelectorOrXPath: '',
        maxTries: 1,
        setZipWithUI: {
          beforeInputSelectorOrXpathArray: null,
          inputSelectorOrXPath: null,
          afterInputSelectorOrXPathArray: null,
          wait: 3000,
        },
      },
      records: [
        {
          checkZipCodeSelectorOrXPath: {
            type: 'cssOrXpath',
            description: 'If not provided or left empty this action is disabled. Selector identifying the element which contains the current value the zipcode is set to. Used to validate the success of the action.',
          },
        },
        {
          maxTries: {
            type: 'number',
            description: 'How many times the action will be attempted before being considered failed. If not set - defaults to 1. If set to 0 the set zipcode action is disabled.',
            optional: true,
          },
        },
        {
          setZipWithUI: {
            type: 'object',
            records: [
              {
                beforeInputSelectorOrXpathArray: {
                  type: 'array',
                  records: 'cssOrXpath',
                  description: 'Ordred array of Xpath or CSS selector to click on before reaching the input where the zipcode will be set becomes visible.',
                  optional: true,
                },
              },
              {
                inputSelectorOrXPath: {
                  type: 'cssOrXpath',
                  description: 'Xpath or CSS selector identifying the input element where the zipcode needs to be set.',
                },
              },
              {
                afterInputSelectorOrXPathArray: {
                  type: 'array',
                  records: 'cssOrXpath',
                  description: 'Ordred array of Xpath or CSS selector to click on after the zipcode has been set. Typically to confirm the zipcode selection',
                  optional: true,
                },
              },
              {
                wait: {
                  type: 'time',
                  description: 'Will do a wait at the end of the action. Defaults to 3000ms',
                  optional: true,
                },
              },
            ],
          },
        },
      ],
    },
    {
      name: 'orderedActionsToPerform',
      type: 'array',
      avanced: true,
      description: 'Ordered list of actions to perform before extraction. Supply an array of objects describing the actions or a single selector to simply perform a click',
      default: [],
      records: [{
        action: {
          type: 'object',
          description: 'Object specifying elements important to the type of action to perfrom',
          records: [
            {
              selectorOrXpath:
              {
                type: 'cssOrXpath',
                description: 'Xpath or CSS selector to identify the key element of the action. If nothing else is provided it will perform a click on the corresponding element.',
              },
            },
            {
              inputValue:
              {
                type: 'string',
                description: 'The value used for the action. If attributeToSet is also provided it will be the value for that attribute. If it is not provided the action will try to type the value inside the element targeted by selectorOrXpath. Only works for editable elements like inputs or text areas.',
                optional: true,
              },
            },
            {
              selectorOrXpathToWaitFor:
              {
                type: 'cssOrXpath',
                description: 'Xpath or CSS to wait for at the end of the action to validate that it was successfull.',
                optional: true,
              },
            },
            {
              attributeToSet:
              {
                type: 'string',
                description: 'Name of an attribute to modify. The subject dom element is targeted by selectorOrXpath and the value to set the attribute to is specified by inputValue',
                optional: true,
              },
            },
            {
              scrollFromSelectorOrXpath:
              {
                type: 'cssOrXpath',
                description: 'Xpath or CSS selector identifying the top element that the scrolling will start from.',
                optional: true,
              },
            },
            {
              stopXPath:
              {
                type: 'cssOrXpath',
                description: 'Xpath or CSS selector specifying a matching condition to interrupt the scrolling early.',
                optional: true,
              },
            },
            {
              doNotScrollXpath:
              {
                type: 'cssOrXpath',
                description: 'Xpath or CSS selector representing elements which should not be scrolled.',
                optional: true,
              },
            },
            {
              steps:
              {
                type: 'number',
                description: 'Value controlling the speed of the scrolling. A value of 1 is extremly slow while a value of 30-40 is ok.',
                optional: true,
              },
            },
            {
              wait:
              {
                type: 'time',
                description: 'If provided - alone or with other attributes - will do a wait at the end of the action, if selectorToWaitFor is also provided, it controls the wait for that selector',
                optional: true,
              },
            },
            {
              captchaCheck:
              {
                type: 'boolean',
                description: 'If provided - alone or with other attributes - will attempt to solve a captcha at that point in the action list. The wait parameter will then control the capctha timeout',
                optional: true,
                default: false,
              },
            },
            {
              waitDisappear:
              {
                type: 'boolean',
                description: 'If provided - never alone - will wait for the specified selector to disappear',
                optional: true,
                default: false,
              },
            },
          ],
        },
      }, 'cssOrXpath'],
    },
    {
      name: 'addAttributeToExtractedRecords',
      description: 'If true the attribute __extracted=true will be added to dom elements that were extracted. This allows to exclude them from the record xpath by adding [not(@__extracted)]',
      type: 'boolean',
      default: false,
    },
    {
      name: 'allowScreenCaptures',
      description: 'Allows the use of screenshots in the extraction config yaml',
      type: 'boolean',
      default: false,
      advanced: true,
    },
    {
      name: 'checkXpathBeforeExtract',
      type: 'xpath',
      description: 'Xpath identifying an element which will trigger a failure if it is not correctly loaded on the page before the extraction starts',
      default: '',
      optional: true,
      advanced: true,
    },
    {
      name: 'checkXpathBeforeExtractTimeout',
      type: 'time',
      description: 'Timeout for checkXpathBeforeExtract, will use loadingTimeout if not set',
      optional: true,
      advanced: true,
    },
    {
      name: 'checkXpathBeforeExtractErrMessageSelector',
      type: 'css',
      description: 'The css selector to an element on the page which will be returned as part of the error message',
      optional: true,
      advanced: true,
    },
    {
      name: 'checkXpathBeforeExtractHaltConditionXpath',
      type: 'xpath',
      description: 'The xpath to an element on the page which indicates that no further retries should be performed',
      optional: true,
      advanced: true,
    },
    {
      name: 'reloadXpath',
      type: 'xpath',
      default: '',
      optional: true,
      advanced: true,
      description: 'XPATH selector to check if we should reload page or report blocked.',
    },
    {
      name: 'loadedSelector',
      type: 'css',
      default: '',
      advanced: true,
      description: 'CSS selector to tell us the page has loaded correctly. If loadedXpath is also provided this setting will be ignored.',
    },
    {
      name: 'appendCookies',
      type: 'boolean',
      default: 'false',
      advanced: true,
      description: 'If enabled this will create an element on the page containing all the cookies with id attribute set to "added_cookies"',
    },
    {
      name: 'preProcessInputs',
      type: 'array',
      default: [],
      advanced: true,
      description: 'Object allowing to modify a url or an input before using it inside the extractor code.',
      records: [
        {
          inputToProcess: {
            type: 'object',
            records: [
              { inputName: 'string' },
              {
                regexSubstituteBeforeAll: {
                  type: 'object',
                  description: 'Can substitute one instance - or multiple depending on the flag - of a character with another',
                  optional: true,
                  records: [
                    { regExp: 'regex' },
                    { regExpReplace: 'string' },
                    {
                      flags: {
                        type: 'string',
                        default: 'g',
                        description: 'Regular expression flags',
                        optional: true,
                      },
                    },
                  ],
                },
              },
              {
                rename: {
                  type: 'string',
                  optional: true,
                  description: 'A new name used to rename the specified input.',
                },
              },
              {
                removeAllQueryAttributes: {
                  type: 'boolean',
                  default: false,
                  description: 'If set to true will delete all the query attributes on the specified input.',
                  optional: true,
                },
              },
              {
                removeSpecificQueryAttributes: {
                  type: 'array',
                  default: [],
                  description: 'Only deletes the specified query attributes on the specified input.',
                  optional: true,
                  records: ['string'],
                },
              },
              {
                onlyKeepSpecificQueryAttributes: {
                  type: 'array',
                  default: [],
                  description: 'Deletes all the other attributes but the one specified.',
                  optional: true,
                  records: ['string'],
                },
              },
              {
                addQueryAttributes: {
                  type: 'object',
                  default: [],
                  description: 'Adds key value pair to the url query parameters { attributeName: attributeValue }, the value is automatically url encoded',
                  optional: true,
                },
              },
              {
                regexSubstituteAfterAll: {
                  type: 'object',
                  description: 'Can substitute one instance - or multiple depending on the flag - of a character with another',
                  optional: true,
                  records: [
                    { regExp: 'regex' },
                    { regExpReplace: 'string' },
                    {
                      flags: {
                        type: 'string',
                        default: 'g',
                        description: 'Regular expression flags',
                        optional: true,
                      },
                    },
                  ],
                },
              },
            ],
          },
        },
      ],
    },
    {
      name: 'fetchErrorStringStart',
      description: 'If set and a fetch goto is used, the fetch will be considered failed when the response starts with this string.',
      type: 'string',
      default: null,
      advanced: true,
    },
    {
      name: 'useGoto2',
      description: 'If set to false, the old goto will be used instead of the goto2',
      type: 'boolean',
      default: true,
      advanced: true,
      hide: true,
    },
    {
      name: 'deleteDuplicateDOMElements',
      description: 'If set to falsy will do nothing, if set to an array of CSS selectors will delete all but the first occurence of the given selectors',
      type: 'array',
      records: 'css',
      default: ['#__input'],
      advanced: true,
      hide: true,
    },
    {
      name: 'enableAutoTable',
      description: 'Set to false to deactivate the automated building of a table when landing on a json.',
      type: 'boolean',
      default: true,
      advanced: true,
      hide: true,
    },
    {
      name: 'mergeType',
      description: 'Way the data should be handled when context.extract is called multiple times, APPEND or MERGE_ROWS',
      type: 'string',
      default: 'APPEND',
      advanced: true,
      hide: true,
    },
    {
      name: 'schemaYAML',
      description: 'Name of the schema.yaml file to use for the extraction',
      type: 'string',
      default: '',
      advanced: true,
      hide: true,
    },
    {
      name: 'paginate',
      description: 'Object containing the set of parameters configuring the pagination process',
      type: 'object',
      ignore: true,
      default: {
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
        },
      },
      records: [
        {
          stopConditionSelectorOrXpath: {
            type: 'cssOrXpath',
            description: 'CSS/XPATH if this selectors returns an element then the pagination is brought to an end',
            optional: true,
          },
        },
        {
          openSearchDefinition: {
            type: 'object',
            description: 'Use this setting if the pagination can be handled with a navigation a "page 2" - either through url query parameters or through url path - this should be the most often used setting.',
            records: [
              {
                template: {
                  type: 'string',
                  description: 'Template specifying how the url should be created by replacing and encoding inputs specified by their name in curly braces - example: {url}/?page={page}. Two extra values are available: {page} which tracks the page number currently on and {index} which tracks the number of elements displayed.',
                },
              },
              {
                pageStartNb: {
                  type: 'number',
                  description: 'Specify the starting value for the page number tracking. Defaults to 1.',
                  optional: true,
                },
              },
              {
                indexOffset: {
                  type: 'number',
                  description: 'Specify a static offset if needed. Default to 0. The formula is {index} = {page} * {pageIndexMultiplier} + {indexOffset}.',
                  optional: true,
                },
              },
              {
                pageOffset: {
                  type: 'number',
                  description: 'Specify a static offset in the page count if needed. Default to 0.',
                  optional: true,
                },
              },
              {
                pageIndexMultiplier: {
                  type: 'number',
                  description: 'Specify a multiplier for the index if needed, useful for pages with many products per page. Default to 0. The formula is {index} = {page} * {pageIndexMultiplier} + {indexOffset}.',
                  optional: true,
                },
              },
            ],
          },
        },
        {
          nextLink: {
            type: 'object',
            description: 'Use this setting if the pagination should be handled with a click on a "next page" button. If any other type of pagination is set, this setting is ignored.',
            records: [
              {
                nextLinkSelectorOrXpath: {
                  type: 'cssOrXpath',
                  description: 'CSS/XPATH selector to identify the element to click on for navigating to the next page',
                },
                mutationSelectorOrXpath: {
                  type: 'cssOrXpath',
                  description: 'CSS/XPATH if provided the pagination will be considered successful when this selector mutates',
                  optional: true,
                },
                spinnerSelectorOrXpath: {
                  type: 'cssOrXpath',
                  description: 'CSS/XPATH if provided the pagination will be considered successful when this selector disappears',
                  optional: true,
                },
                nextLinkTimeout: {
                  type: 'time',
                  description: 'Time to wait for a given xpath, the mutation to happen or for the spinner to disappear. Defaults to 5000ms.',
                  optional: true,
                },
                waitForXpath: {
                  type: 'xpath',
                  description: 'XPATH if provided the navigation to the next page will be considered successful when this selector appears',
                  optional: true,
                },
              },
            ],
          },
        },
        {
          infiniteScroll: {
            type: 'object',
            description: 'Use this setting if the pagination absolutely cannot be handled any other way. This will perform multiple scroll to try to load all the elements which may result in page crashes. The setting addAttributeToExtractedRecords will automatically be turned on.',
            records: [
              {
                maxScrolls: {
                  description: 'Number of scroll retries done when landing on a page to try to reach the bottom. If not provided the infinitescrolling settings will be ignored.',
                  type: 'number',
                },
              },
              {
                stopXPath: {
                  type: 'xpath',
                  description: 'XPath for the element to stop. In case element specified by the xpath appears anywhere on the page - the scrolling will stop.',
                  optional: true,
                },
              },
              {
                waitTime: {
                  type: 'time',
                  description: 'Time in milliseconds between scrolls (not total time!). Browser will wait for the specified time after the last scroll for the new content to appear. If no content appears - will return. If any content appears - will scroll down again.',
                  optional: true,
                },
              },
              {
                scrollFunction: {
                  type: 'enum',
                  records: ['scrollToBottom', 'scrollIntoView'],
                  description: 'The scrolling function to use. Defaults to scrollToBottom.',
                  optional: true,
                },
              },
              {
                scrollToElementSelectorOrXpath: {
                  type: 'cssOrXpath',
                  description: 'Only applies with scrollIntoView function. Identifies the target element for the scrolling.',
                  optional: true,
                },
              },
              {
                infiniteScrollTimeout: {
                  type: 'time',
                  optional: true,
                  description: 'Optional for scrollToBottom where it allows to abort the scrolling early after a specific timeout. For scrollIntoView it will default to 500ms and represent the wait time in between scrolling steps.',
                },
              },
            ],
          },
        },
        {
          nestedPagination: {
            type: 'object',
            description: 'This object enables the nested pagination code, it works "breadth first" and also supports rewriting any of the other parameters for the second level',
            records: [
              {
                nextDepthURLFieldName: {
                  type: 'string',
                  description: 'The name of a field in the extract.yaml to harevest the next level of URLs. Mandatory field. This will control how many rows will ultimately be generated. Must be a fully qualified URL or can be combined with URLTemplate parameter.',
                },
              },
              {
                markToRemove: {
                  type: 'enum',
                  description: 'Describing what to do with the data collected at N-1 level. By default it will mark to remove it. ONLY_IF_FOUND means that the data will be marked to be removed on in the case where an extra level N is found.',
                  records: ['ONLY_IF_FOUND', true, false],
                },
              },
              {
                paginate: {
                  type: 'paginate',
                  description: 'A fully fledged paginate object describing how to paginate when one level deeper.',
                },
              },
              'object', // supports any of the parameters described in here to override their value at level N+1
            ],
            optional: true,
            hide: true,
            nextDepthURLFieldName: null,
            paginate: null,
          },
        },
      ],
    },
    {
      name: 'country',
      type: 'string',
      description: 'ISO 2 letters code for the country',
      ignore: true,
    },
  ],
  inputs: [
    {
      name: 'URL',
      description: 'URL to access directly',
      type: 'string',
      optional: true,
    },
    {
      name: 'id',
      description: 'product ID to access directly',
      type: 'string',
      optional: true,
    },
    {
      name: 'RPC',
      description: 'rpc for product to access directly',
      type: 'string',
      optional: true,
    },
    {
      name: 'SKU',
      description: 'sku for product to access directly',
      type: 'string',
      optional: true,
    },
    {
      name: 'UPC',
      description: 'UPC for product',
      type: 'string',
      optional: true,
    },
    {
      name: 'keywords',
      description: 'keywords to search for',
      type: 'string',
      optional: true,
    },
    {
      name: 'brands',
      description: 'brands to search for',
      type: 'string',
    },
    {
      name: 'resultsTarget',
      description: 'the target number of results needed before stopping the extraction',
      type: 'number',
    },
    {
      name: 'storeID',
      description: 'Id of the store',
      type: 'string',
      optional: true,
    },
    {
      name: 'query',
      description: 'Query parameter to provide directly to the URL when it is built',
      type: 'string',
      optional: true,
    },
  ],
  dependencies: {
    extract: 'action:robots/san-antonio/extract',
    paginate: 'action:navigation/paginate',
    goto: 'action:navigation/goto',
    validatePage: 'action:navigation/validatePage',
    goto2: 'action:navigation/goto2',
    dataHelper: 'module:helpers/data',
    createUrl: 'action:navigation/createURL',
    preProcessInputs: 'action:navigation/preProcessInputs',
  },
  path: './san-antonio/domains/${domain[0:1]}/${domain}/${country}/index',
  implementation: async (inputsO, parameters, context, dependencies) => {
    const {
      extract, paginate, createUrl, validatePage, dataHelper: { DataModifier }, preProcessInputs,
    } = dependencies;
    const { useGoto2 = true } = parameters;

    const recursiveImplementation = async (inputs) => {
      const {
        URL, url, _url, keywords, id, RPC, SKU, UPC, brands,
      } = inputs;

      const newInput = await preProcessInputs({
        originalInputs: inputs.originalInputs || inputs,
        ...parameters,
        url: url || URL || _url,
        id: RPC || SKU || UPC || id,
        keywords: keywords || brands,
        ...inputs,
        resultsTarget: Math.min(+parameters.resultsTarget || +inputs.resultsTarget, +inputs.resultsTarget || +parameters.resultsTarget) || 1,
      });

      // if orderedActionsToPerform is defined, specific parameters are required
      if (newInput.orderedActionsToPerform && newInput.orderedActionsToPerform.length) {
        for (let index = 0; index < newInput.orderedActionsToPerform.length; index += 1) {
          const { selectorOrXpath } = newInput.orderedActionsToPerform[index];
          if (!selectorOrXpath) throw new Error('If orderedActionsToPerform is being set, the selectorOrXpath parameter must be set');
        }
      }

      // old execute file now merged into the action file
      const builtUrl = !newInput.url || newInput.URLTemplate ? await createUrl(newInput) : newInput.url;
      if (!builtUrl) return context.halt(true); // graceful exit when not able to create a url

      newInput.newGoto2 = await dependencies[useGoto2 ? 'goto2' : 'goto']({ ...newInput, url: builtUrl });

      await validatePage(newInput);

      // try gettings some search results
      const pageOne = await extract(newInput);

      let resultsCollected = DataModifier.nbCollected(pageOne);

      console.log(`[========] Collected a total of ${resultsCollected} on the first page [========]${newInput.depthString || ''}`);

      // get nested pagination fieldName
      const { nestedPagination = {} } = newInput.paginate || {};
      const { nextDepthURLFieldName } = nestedPagination;
      if (!nextDepthURLFieldName && Object.keys(nestedPagination).length && Object.values(nestedPagination).filter(el => el).length) {
        // throw an error early if the parameter is not built correctly
        throw new Error(`If nested pagination is used then a nextDepthURLFieldName is required, ${inputs.depthString}`);
      }

      // Exit early if the first page didn't have any data or if we shouldn't paginate
      if (resultsCollected === 0 || (newInput.id && !nextDepthURLFieldName && +newInput.resultsTarget === 0)) return null;

      newInput.returnDataWhenHalt = newInput.returnDataWhenHalt ?? true; // matching the no result xpath will stop the run without discarding the data already collected
      let arrayToConcatWith = DataModifier.extractFieldasArray(pageOne, nestedPagination);

      let page = 2;
      while (resultsCollected < +newInput.resultsTarget && await paginate({ ...newInput, page, offset: resultsCollected })) {
        const data = await extract(newInput);
        const resultsCount = DataModifier.nbCollected(data);
        arrayToConcatWith = DataModifier.extractFieldasArray(data, nestedPagination, { arrayToConcatWith });
        if (resultsCount === 0) break; // no additional results
        resultsCollected += resultsCount;
        console.log(`[========] Collected ${resultsCount} results on page ${page} for a current total of ${resultsCollected} results [========]${newInput.depthString || ''}`);
        page += 1;
      }
      if (arrayToConcatWith.length) console.log(`There are ${arrayToConcatWith.length} items in the recursive loop.${newInput.depthString || ''}`);
      // Case where nested URLs were collected and now need to be processed
      for (let index = 0; index < arrayToConcatWith.length; index += 1) {
        console.log(arrayToConcatWith[index]);
        const nestedNewInputs = {
          ...newInput,
          depth: (newInput.depth || 0) + 1,
          depthString: `depth: ${(newInput.depth || 0) + 1}, iter:${index}`,
          ...arrayToConcatWith[index].value,
          injectable: {
            previousURL: builtUrl,
            ...(newInput.injectable || {}),
            ...arrayToConcatWith[index].value,
          },
          currentIndex: index,
          url: arrayToConcatWith[index].key,
          ...(nestedPagination?.paginate ? nestedPagination : { ...nestedPagination, paginate: null }),
          previousURL: builtUrl,
        };
        resultsCollected += await recursiveImplementation(nestedNewInputs);
        console.log(`There are ${arrayToConcatWith.length - index - 1} items remaining in the recursive loop.${newInput.depthString || ''}`);
      }
      // eslint-disable-next-line no-underscore-dangle
      console.log(`[========] Collected ${resultsCollected} results in total with target: ${newInput.resultsTarget} [========]${newInput.depthString || ''}`);
      return resultsCollected;
    };
    return await recursiveImplementation(inputsO);
  },
};
