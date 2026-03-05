// Parameter definition types and static config for dashboard forms.
// Source of truth: robot-library/src/library/robots/san-antonio/action.js lines 10-670

export type FieldType =
  | 'string'
  | 'xpath'
  | 'css'
  | 'cssOrXpath'
  | 'number'
  | 'time'
  | 'boolean'
  | 'enum'
  | 'array'
  | 'object'
  | 'regex'
  | 'paginate';

export interface FieldDefinition {
  name: string;
  type: FieldType;
  description: string;
  default?: unknown;
  optional?: boolean;
  advanced?: boolean;
  hide?: boolean;
  ignore?: boolean;
  enumOptions?: string[];
  records?: FieldDefinition[] | FieldType;
}

export const PARAMETER_DEFINITIONS: FieldDefinition[] = [
  {
    name: 'loadedXpath',
    type: 'xpath',
    description: 'XPath selector to tell us the page has loaded correctly. If loadedSelector is also provided, only loadedXpath will be considered.',
    default: '',
  },
  {
    name: 'noResultsXPath',
    type: 'xpath',
    description: 'XPath to tell us the page has loaded but does not contain any valid result.',
    default: '//h1[contains(text(),"404")]',
  },
  {
    name: 'accessDeniedXPath',
    type: 'xpath',
    description: 'XPath to tell us the page has loaded but is displaying a block message.',
    default: '//h1[contains(text(),"Denied")]',
  },
  {
    name: 'loadingTimeout',
    type: 'time',
    description: 'Waiting time for loaded xpath and no result xpath (ms).',
    default: 5000,
  },
  {
    name: 'waitForSelectorToLoad',
    type: 'css',
    description: 'CSS selector that we want to take the time to wait for.',
    default: '',
  },
  {
    name: 'URLTemplate',
    type: 'string',
    description: 'Template specifying how the URL should be created by replacing inputs in curly braces — e.g. https://domain.com/{pageID}',
    optional: true,
  },
  {
    name: 'resultsTarget',
    type: 'number',
    description: 'The target number of results needed before stopping the extraction.',
    default: 1,
  },
  {
    name: 'orderedSelectorsToClickOn',
    type: 'array',
    description: 'Ordered list of CSS/XPath selectors to click on before extraction (e.g. show more, close overlay).',
    default: [],
    records: 'cssOrXpath',
  },
  {
    name: 'arrayOfInputFieldNamesToAdd',
    type: 'array',
    description: 'Field names from inputs or nested pagination to add to output. Supports renaming via objects: ["field1", {"field2": "newName"}].',
    default: [],
    records: 'string',
  },
  {
    name: 'zipcode',
    type: 'string',
    description: 'Value used to set the location.',
    optional: true,
    default: '',
  },
  {
    name: 'maxScrolls',
    type: 'number',
    description: 'Number of scroll retries done when landing on a page to try to reach the bottom.',
    default: 1,
  },
  {
    name: 'bypassExtract',
    type: 'boolean',
    description: 'Turn on to avoid calling context.extract().',
    default: false,
  },
  {
    name: 'setZipCode',
    type: 'object',
    description: 'A specialized series of actions to set a zipcode on a page.',
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
        name: 'checkZipCodeSelectorOrXPath',
        type: 'cssOrXpath',
        description: 'Selector for the element containing the current zipcode value. Used to validate success. If empty, this action is disabled.',
      },
      {
        name: 'maxTries',
        type: 'number',
        description: 'How many times the action will be attempted. If 0, the set zipcode action is disabled.',
        optional: true,
      },
      {
        name: 'setZipWithUI',
        type: 'object',
        description: 'UI-based zipcode setting configuration.',
        records: [
          {
            name: 'beforeInputSelectorOrXpathArray',
            type: 'array',
            records: 'cssOrXpath',
            description: 'Ordered array of selectors to click before the zipcode input becomes visible.',
            optional: true,
          },
          {
            name: 'inputSelectorOrXPath',
            type: 'cssOrXpath',
            description: 'Selector for the input element where the zipcode is set.',
          },
          {
            name: 'afterInputSelectorOrXPathArray',
            type: 'array',
            records: 'cssOrXpath',
            description: 'Ordered array of selectors to click after the zipcode has been set (e.g. confirm button).',
            optional: true,
          },
          {
            name: 'wait',
            type: 'time',
            description: 'Wait time after the action completes. Defaults to 3000ms.',
            optional: true,
          },
        ],
      },
    ],
  },
  {
    name: 'orderedActionsToPerform',
    type: 'array',
    description: 'Ordered list of actions to perform before extraction. Each item is an action object or a simple selector string for a click.',
    default: [],
    advanced: true,
    records: [
      {
        name: 'selectorOrXpath',
        type: 'cssOrXpath',
        description: 'Selector for the key element. If nothing else is provided, performs a click.',
      },
      {
        name: 'inputValue',
        type: 'string',
        description: 'Value for the action. If attributeToSet is provided, sets that attribute. Otherwise types the value into the element.',
        optional: true,
      },
      {
        name: 'selectorOrXpathToWaitFor',
        type: 'cssOrXpath',
        description: 'Selector to wait for after the action, to validate success.',
        optional: true,
      },
      {
        name: 'attributeToSet',
        type: 'string',
        description: 'Name of a DOM attribute to modify on the target element.',
        optional: true,
      },
      {
        name: 'scrollFromSelectorOrXpath',
        type: 'cssOrXpath',
        description: 'Selector for the top element that scrolling starts from.',
        optional: true,
      },
      {
        name: 'stopXPath',
        type: 'cssOrXpath',
        description: 'Selector to interrupt scrolling early when matched.',
        optional: true,
      },
      {
        name: 'doNotScrollXpath',
        type: 'cssOrXpath',
        description: 'Selector for elements that should not be scrolled.',
        optional: true,
      },
      {
        name: 'steps',
        type: 'number',
        description: 'Scroll speed. 1 = very slow, 30-40 = normal.',
        optional: true,
      },
      {
        name: 'wait',
        type: 'time',
        description: 'Wait time (ms) after the action. If selectorToWaitFor is set, controls that timeout.',
        optional: true,
      },
      {
        name: 'captchaCheck',
        type: 'boolean',
        description: 'If true, attempts to solve a captcha at this point. The wait parameter controls the captcha timeout.',
        optional: true,
        default: false,
      },
      {
        name: 'waitDisappear',
        type: 'boolean',
        description: 'If true, waits for the specified selector to disappear.',
        optional: true,
        default: false,
      },
    ],
  },
  {
    name: 'addAttributeToExtractedRecords',
    type: 'boolean',
    description: 'If true, adds __extracted=true attribute to extracted DOM elements. Allows excluding them with [not(@__extracted)].',
    default: false,
  },
  {
    name: 'allowScreenCaptures',
    type: 'boolean',
    description: 'Allows the use of screenshots in the extraction config YAML.',
    default: false,
    advanced: true,
  },
  {
    name: 'checkXpathBeforeExtract',
    type: 'xpath',
    description: 'XPath identifying an element that must be present before extraction starts. Triggers failure if missing.',
    default: '',
    optional: true,
    advanced: true,
  },
  {
    name: 'checkXpathBeforeExtractTimeout',
    type: 'time',
    description: 'Timeout for checkXpathBeforeExtract. Uses loadingTimeout if not set.',
    optional: true,
    advanced: true,
  },
  {
    name: 'checkXpathBeforeExtractErrMessageSelector',
    type: 'css',
    description: 'CSS selector to an element whose text is included in the error message.',
    optional: true,
    advanced: true,
  },
  {
    name: 'checkXpathBeforeExtractHaltConditionXpath',
    type: 'xpath',
    description: 'XPath to an element indicating no further retries should be performed.',
    optional: true,
    advanced: true,
  },
  {
    name: 'reloadXpath',
    type: 'xpath',
    description: 'XPath selector to check if the page should be reloaded or reported as blocked.',
    default: '',
    optional: true,
    advanced: true,
  },
  {
    name: 'loadedSelector',
    type: 'css',
    description: 'CSS selector to tell us the page has loaded. Ignored if loadedXpath is also provided.',
    default: '',
    advanced: true,
  },
  {
    name: 'appendCookies',
    type: 'boolean',
    description: 'If enabled, creates an element on the page containing all cookies with id="added_cookies".',
    default: false,
    advanced: true,
  },
  {
    name: 'preProcessInputs',
    type: 'array',
    description: 'Object allowing modification of a URL or input before using it in the extractor.',
    default: [],
    advanced: true,
    records: [
      {
        name: 'inputName',
        type: 'string',
        description: 'The name of the input field to process.',
      },
      {
        name: 'rename',
        type: 'string',
        description: 'New name to rename the input field to.',
        optional: true,
      },
      {
        name: 'removeAllQueryAttributes',
        type: 'boolean',
        description: 'If true, deletes all query attributes from the URL.',
        default: false,
        optional: true,
      },
      {
        name: 'removeSpecificQueryAttributes',
        type: 'array',
        description: 'Only deletes the specified query attributes.',
        default: [],
        optional: true,
        records: 'string',
      },
      {
        name: 'onlyKeepSpecificQueryAttributes',
        type: 'array',
        description: 'Deletes all attributes except those specified.',
        default: [],
        optional: true,
        records: 'string',
      },
      {
        name: 'regexSubstituteBeforeAll',
        type: 'object',
        description: 'Regex substitution applied before all other transformations.',
        optional: true,
        records: [
          { name: 'regExp', type: 'regex', description: 'Regular expression pattern.' },
          { name: 'regExpReplace', type: 'string', description: 'Replacement string.' },
          { name: 'flags', type: 'string', description: 'Regex flags (default: "g").', optional: true, default: 'g' },
        ],
      },
      {
        name: 'regexSubstituteAfterAll',
        type: 'object',
        description: 'Regex substitution applied after all other transformations.',
        optional: true,
        records: [
          { name: 'regExp', type: 'regex', description: 'Regular expression pattern.' },
          { name: 'regExpReplace', type: 'string', description: 'Replacement string.' },
          { name: 'flags', type: 'string', description: 'Regex flags (default: "g").', optional: true, default: 'g' },
        ],
      },
    ],
  },
  {
    name: 'fetchErrorStringStart',
    type: 'string',
    description: 'If set and a fetch goto is used, the fetch is considered failed when the response starts with this string.',
    default: null,
    advanced: true,
  },
  {
    name: 'useGoto2',
    type: 'boolean',
    description: 'If false, uses the old goto instead of goto2.',
    default: true,
    advanced: true,
    hide: true,
  },
  {
    name: 'deleteDuplicateDOMElements',
    type: 'array',
    description: 'Array of CSS selectors — deletes all but the first occurrence of each.',
    records: 'css',
    default: ['#__input'],
    advanced: true,
    hide: true,
  },
  {
    name: 'enableAutoTable',
    type: 'boolean',
    description: 'Set to false to deactivate the automated building of a table when landing on JSON.',
    default: true,
    advanced: true,
    hide: true,
  },
  {
    name: 'mergeType',
    type: 'enum',
    description: 'How data should be handled when context.extract is called multiple times.',
    default: 'APPEND',
    enumOptions: ['APPEND', 'MERGE_ROWS'],
    advanced: true,
    hide: true,
  },
  {
    name: 'schemaYAML',
    type: 'string',
    description: 'Name of the schema YAML file to use for extraction.',
    default: '',
    advanced: true,
    hide: true,
  },
  {
    name: 'storeID',
    type: 'string',
    description: 'Store identifier for site-specific features.',
    optional: true,
  },
  {
    name: 'paginate',
    type: 'object',
    description: 'Object containing parameters configuring the pagination process.',
    ignore: false,
    default: {},
    records: [
      {
        name: 'stopConditionSelectorOrXpath',
        type: 'cssOrXpath',
        description: 'If this selector returns an element, pagination ends.',
        optional: true,
      },
      {
        name: 'openSearchDefinition',
        type: 'object',
        description: 'Use if pagination can be handled with URL-based page navigation (most common).',
        optional: true,
        records: [
          {
            name: 'template',
            type: 'string',
            description: 'URL template with {url}, {page}, {index} — e.g. {url}/?page={page}',
          },
          {
            name: 'pageStartNb',
            type: 'number',
            description: 'Starting value for page number. Defaults to 1.',
            optional: true,
          },
          {
            name: 'indexOffset',
            type: 'number',
            description: 'Static offset for {index}. Default 0. Formula: {index} = {page} * pageIndexMultiplier + indexOffset.',
            optional: true,
          },
          {
            name: 'pageOffset',
            type: 'number',
            description: 'Static offset for page count. Default 0.',
            optional: true,
          },
          {
            name: 'pageIndexMultiplier',
            type: 'number',
            description: 'Multiplier for {index}. Default 0. Formula: {index} = {page} * pageIndexMultiplier + indexOffset.',
            optional: true,
          },
        ],
      },
      {
        name: 'nextLink',
        type: 'object',
        description: 'Use if pagination needs a click on a "next page" button. Ignored if openSearchDefinition is set.',
        optional: true,
        records: [
          {
            name: 'nextLinkSelectorOrXpath',
            type: 'cssOrXpath',
            description: 'Selector for the next page button.',
          },
          {
            name: 'mutationSelectorOrXpath',
            type: 'cssOrXpath',
            description: 'Pagination succeeds when this selector mutates.',
            optional: true,
          },
          {
            name: 'spinnerSelectorOrXpath',
            type: 'cssOrXpath',
            description: 'Pagination succeeds when this selector disappears.',
            optional: true,
          },
          {
            name: 'nextLinkTimeout',
            type: 'time',
            description: 'Wait time for mutation/spinner/xpath. Defaults to 5000ms.',
            optional: true,
          },
          {
            name: 'waitForXpath',
            type: 'xpath',
            description: 'Pagination succeeds when this XPath appears.',
            optional: true,
          },
        ],
      },
      {
        name: 'infiniteScroll',
        type: 'object',
        description: 'Use only as a last resort — scrolls to load elements, may cause page crashes. Turns on addAttributeToExtractedRecords.',
        optional: true,
        records: [
          {
            name: 'maxScrolls',
            type: 'number',
            description: 'Number of scroll retries. If not provided, infinite scrolling is ignored.',
          },
          {
            name: 'stopXPath',
            type: 'xpath',
            description: 'XPath — stops scrolling when this element appears.',
            optional: true,
          },
          {
            name: 'waitTime',
            type: 'time',
            description: 'Time (ms) between scrolls for new content to appear.',
            optional: true,
          },
          {
            name: 'scrollFunction',
            type: 'enum',
            description: 'Scrolling function to use. Defaults to scrollToBottom.',
            enumOptions: ['scrollToBottom', 'scrollIntoView'],
            optional: true,
          },
          {
            name: 'scrollToElementSelectorOrXpath',
            type: 'cssOrXpath',
            description: 'Target element for scrollIntoView function.',
            optional: true,
          },
          {
            name: 'infiniteScrollTimeout',
            type: 'time',
            description: 'For scrollToBottom: abort early after timeout. For scrollIntoView: wait between steps (default 500ms).',
            optional: true,
          },
        ],
      },
      {
        name: 'nestedPagination',
        type: 'object',
        description: 'Enables nested (breadth-first) pagination. Supports overriding parent parameters at the next level.',
        optional: true,
        hide: true,
        records: [
          {
            name: 'nextDepthURLFieldName',
            type: 'string',
            description: 'Field name in extract.yaml containing URLs for the next level. Must be a fully qualified URL or combinable with URLTemplate.',
          },
          {
            name: 'markToRemove',
            type: 'enum',
            description: 'What to do with N-1 level data. Default: true (remove). ONLY_IF_FOUND removes only if next level data exists.',
            enumOptions: ['ONLY_IF_FOUND', 'true', 'false'],
            optional: true,
          },
          {
            name: 'paginate',
            type: 'paginate',
            description: 'A fully fledged paginate object for the next depth level.',
            optional: true,
          },
        ],
      },
    ],
  },
  {
    name: 'country',
    type: 'string',
    description: 'ISO 2-letter country code.',
    ignore: true,
  },
  {
    name: 'domain',
    type: 'string',
    description: 'Domain name.',
    ignore: true,
  },
];

export const PARAMETER_GROUPS: Record<string, string[]> = {
  'Page Loading': [
    'loadedXpath',
    'loadedSelector',
    'waitForSelectorToLoad',
    'loadingTimeout',
    'noResultsXPath',
    'accessDeniedXPath',
    'reloadXpath',
  ],
  'URL & Input': [
    'URLTemplate',
    'zipcode',
    'storeID',
    'preProcessInputs',
  ],
  'Extraction': [
    'schemaYAML',
    'resultsTarget',
    'maxScrolls',
    'bypassExtract',
    'enableAutoTable',
    'mergeType',
    'addAttributeToExtractedRecords',
    'allowScreenCaptures',
    'deleteDuplicateDOMElements',
  ],
  'Pre-Extract Actions': [
    'orderedSelectorsToClickOn',
    'orderedActionsToPerform',
  ],
  'Pre-Extract Checks': [
    'checkXpathBeforeExtract',
    'checkXpathBeforeExtractTimeout',
    'checkXpathBeforeExtractErrMessageSelector',
    'checkXpathBeforeExtractHaltConditionXpath',
  ],
  'Zip Code': ['setZipCode'],
  'Pagination': ['paginate'],
  'Navigation': [
    'useGoto2',
    'appendCookies',
    'fetchErrorStringStart',
  ],
  'Input Fields': ['arrayOfInputFieldNamesToAdd'],
};

/** Lookup a parameter definition by name */
export function getParameterDef(name: string): FieldDefinition | undefined {
  return PARAMETER_DEFINITIONS.find((d) => d.name === name);
}

/** Get all visible (non-ignored) parameter definitions */
export function getVisibleParameters(): FieldDefinition[] {
  return PARAMETER_DEFINITIONS.filter((d) => !d.ignore);
}

/** Get non-advanced visible parameters */
export function getBasicParameters(): FieldDefinition[] {
  return PARAMETER_DEFINITIONS.filter((d) => !d.ignore && !d.advanced && !d.hide);
}
