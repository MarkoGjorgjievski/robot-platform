const { createMockContext } = require('../../__mocks__/context');
const { DataModifier } = require('../../helpers/data');

// Load the actual module under test
const sanAntonioAction = require('../san-antonio/action');

describe('san-antonio/action (Tier 4)', () => {
  let context;
  let dependencies;
  let defaultInputs;
  let defaultParameters;

  beforeEach(() => {
    context = createMockContext();

    dependencies = {
      extract: vi.fn().mockResolvedValue([{ group: [{ field: [{ text: 'value1' }] }] }]),
      paginate: vi.fn().mockResolvedValue(false),
      goto: vi.fn().mockResolvedValue({}),
      goto2: vi.fn().mockResolvedValue({}),
      validatePage: vi.fn().mockResolvedValue(undefined),
      dataHelper: { DataModifier },
      createUrl: vi.fn().mockResolvedValue('https://example.com/built-url'),
      preProcessInputs: vi.fn().mockImplementation(async (input) => input),
    };

    defaultInputs = {
      url: 'https://example.com/product',
      keywords: 'test',
      resultsTarget: 5,
    };

    defaultParameters = {
      resultsTarget: 5,
      useGoto2: true,
      orderedActionsToPerform: [],
      paginate: {},
    };
  });

  // Test 1
  it('calls preProcessInputs with merged inputs and parameters', async () => {
    await sanAntonioAction.implementation(defaultInputs, defaultParameters, context, dependencies);

    expect(dependencies.preProcessInputs).toHaveBeenCalledTimes(1);
    const callArg = dependencies.preProcessInputs.mock.calls[0][0];
    expect(callArg).toHaveProperty('url', defaultInputs.url);
    expect(callArg).toHaveProperty('keywords', defaultInputs.keywords);
    expect(callArg).toHaveProperty('resultsTarget');
  });

  // Test 2
  it('builds URL via createUrl when no url in input', async () => {
    const inputsNoUrl = { keywords: 'test', resultsTarget: 5, URLTemplate: 'https://example.com/{keywords}' };
    dependencies.preProcessInputs.mockImplementation(async (input) => input);

    await sanAntonioAction.implementation(inputsNoUrl, defaultParameters, context, dependencies);

    expect(dependencies.createUrl).toHaveBeenCalled();
  });

  // Test 3
  it('uses existing url when provided (skips createUrl)', async () => {
    const inputsWithUrl = { url: 'https://example.com/existing', resultsTarget: 5 };
    // preProcessInputs returns input with url and no URLTemplate
    dependencies.preProcessInputs.mockImplementation(async (input) => ({ ...input, URLTemplate: undefined }));

    await sanAntonioAction.implementation(inputsWithUrl, defaultParameters, context, dependencies);

    expect(dependencies.createUrl).not.toHaveBeenCalled();
  });

  // Test 4
  it('calls goto2 by default (useGoto2 = true)', async () => {
    await sanAntonioAction.implementation(defaultInputs, { ...defaultParameters, useGoto2: true }, context, dependencies);

    expect(dependencies.goto2).toHaveBeenCalled();
    expect(dependencies.goto).not.toHaveBeenCalled();
  });

  // Test 5
  it('calls goto when useGoto2 = false', async () => {
    await sanAntonioAction.implementation(defaultInputs, { ...defaultParameters, useGoto2: false }, context, dependencies);

    expect(dependencies.goto).toHaveBeenCalled();
    expect(dependencies.goto2).not.toHaveBeenCalled();
  });

  // Test 6
  it('calls validatePage after navigation', async () => {
    const callOrder = [];
    dependencies.goto2.mockImplementation(async () => { callOrder.push('goto2'); return {}; });
    dependencies.validatePage.mockImplementation(async () => { callOrder.push('validatePage'); });
    dependencies.extract.mockImplementation(async () => { callOrder.push('extract'); return [{ group: [{ f: [{ text: 'v' }] }] }]; });

    await sanAntonioAction.implementation(defaultInputs, defaultParameters, context, dependencies);

    expect(callOrder.indexOf('validatePage')).toBeGreaterThan(callOrder.indexOf('goto2'));
    expect(callOrder.indexOf('validatePage')).toBeLessThan(callOrder.indexOf('extract'));
  });

  // Test 7
  it('calls extract for first page results', async () => {
    await sanAntonioAction.implementation(defaultInputs, defaultParameters, context, dependencies);

    expect(dependencies.extract).toHaveBeenCalled();
  });

  // Test 8
  it('calls context.halt when URL cannot be built (createUrl returns null)', async () => {
    const inputsNoUrl = { keywords: 'test', resultsTarget: 5, URLTemplate: 'https://example.com/{keywords}' };
    dependencies.createUrl.mockResolvedValue(null);
    dependencies.preProcessInputs.mockImplementation(async (input) => input);

    await sanAntonioAction.implementation(inputsNoUrl, defaultParameters, context, dependencies);

    expect(context.halt).toHaveBeenCalledWith(true);
  });

  // Test 9
  it('returns null when no results on first page', async () => {
    dependencies.extract.mockResolvedValue([{ group: [] }]);

    const result = await sanAntonioAction.implementation(defaultInputs, defaultParameters, context, dependencies);

    expect(result).toBeNull();
  });

  // Test 10
  it('paginates when resultsCollected < resultsTarget', async () => {
    const inputsHighTarget = { url: 'https://example.com/product', resultsTarget: 10 };
    const params = { ...defaultParameters, resultsTarget: 10 };

    // First extract call returns 3 results
    dependencies.extract
      .mockResolvedValueOnce([{ group: [{ f: [{ text: '1' }] }, { f: [{ text: '2' }] }, { f: [{ text: '3' }] }] }])
      .mockResolvedValueOnce([{ group: [{ f: [{ text: '4' }] }, { f: [{ text: '5' }] }, { f: [{ text: '6' }] }] }]);

    // Paginate returns true once, then false
    dependencies.paginate
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);

    await sanAntonioAction.implementation(inputsHighTarget, params, context, dependencies);

    expect(dependencies.paginate).toHaveBeenCalled();
    expect(dependencies.extract).toHaveBeenCalledTimes(2);
  });

  // Test 11
  it('stops pagination when no additional results', async () => {
    const inputsHighTarget = { url: 'https://example.com/product', resultsTarget: 100 };
    const params = { ...defaultParameters, resultsTarget: 100 };

    dependencies.extract
      .mockResolvedValueOnce([{ group: [{ f: [{ text: '1' }] }] }])
      .mockResolvedValueOnce([{ group: [] }]); // no results on page 2

    dependencies.paginate.mockResolvedValue(true);

    await sanAntonioAction.implementation(inputsHighTarget, params, context, dependencies);

    // Should stop after second extract returns 0 results
    expect(dependencies.extract).toHaveBeenCalledTimes(2);
  });

  // Test 12
  it('respects resultsTarget (stops when enough collected)', async () => {
    const inputsLowTarget = { url: 'https://example.com/product', resultsTarget: 2 };
    const params = { ...defaultParameters, resultsTarget: 2 };

    // First page already has 3 results (>= target of 2)
    dependencies.extract.mockResolvedValue([{ group: [{ f: [{ text: '1' }] }, { f: [{ text: '2' }] }, { f: [{ text: '3' }] }] }]);

    const result = await sanAntonioAction.implementation(inputsLowTarget, params, context, dependencies);

    // Should not paginate because 3 >= 2
    expect(dependencies.paginate).not.toHaveBeenCalled();
    expect(result).toBe(3);
  });

  // Test 13
  it('validates orderedActionsToPerform has selectorOrXpath (throws Error without it)', async () => {
    dependencies.preProcessInputs.mockImplementation(async (input) => ({
      ...input,
      orderedActionsToPerform: [{ inputValue: 'someValue' }], // missing selectorOrXpath
    }));

    await expect(
      sanAntonioAction.implementation(defaultInputs, defaultParameters, context, dependencies),
    ).rejects.toThrow('selectorOrXpath parameter must be set');
  });

  // Test 14
  it('handles nested pagination (extracts URLs from data, recurses)', async () => {
    const nestedParams = {
      ...defaultParameters,
      resultsTarget: 10,
      paginate: {
        nestedPagination: {
          nextDepthURLFieldName: 'productUrl',
          markToRemove: true,
        },
      },
    };
    const inputs = { url: 'https://example.com/list', resultsTarget: 10 };

    // First call: returns data with nested URLs
    dependencies.extract
      .mockResolvedValueOnce([{
        group: [{
          productUrl: [{ text: 'https://example.com/product/1', xpath: '//a' }],
          name: [{ text: 'Product 1' }],
        }],
      }])
      // Second call (recursive for nested URL): returns product data
      .mockResolvedValueOnce([{
        group: [{ name: [{ text: 'Product 1 Detail' }] }],
      }]);

    dependencies.createUrl
      .mockResolvedValueOnce('https://example.com/list')
      .mockResolvedValueOnce('https://example.com/product/1');

    dependencies.preProcessInputs.mockImplementation(async (input) => input);

    await sanAntonioAction.implementation(inputs, nestedParams, context, dependencies);

    // Extract should be called twice: once for the list, once for the nested URL
    expect(dependencies.extract).toHaveBeenCalledTimes(2);
  });

  // Test 15
  it('returns total resultsCollected', async () => {
    dependencies.extract.mockResolvedValue([{
      group: [
        { field: [{ text: 'val1' }] },
        { field: [{ text: 'val2' }] },
      ],
    }]);

    const result = await sanAntonioAction.implementation(defaultInputs, defaultParameters, context, dependencies);

    expect(typeof result).toBe('number');
    expect(result).toBe(2);
  });
});
