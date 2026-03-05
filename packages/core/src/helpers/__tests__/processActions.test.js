// vi, describe, it, expect, beforeEach, afterEach are available globally via vitest config

// MUST mock navigationHelperLibrary before requiring helpers.js
vi.mock('../../navigation/navigationHelperLibrary', () => ({
  preCompileFunctions: {
    getYAMLs: vi.fn().mockResolvedValue({}),
  },
}));

const { createMockContext } = require('../../__mocks__/context');
const { implementation } = require('../processActions');

describe('processActions', () => {
  let ctx;
  let mockHelper;
  let deps;

  beforeEach(() => {
    ctx = createMockContext();
    mockHelper = {
      checkAndClick: vi.fn().mockResolvedValue(undefined),
      checkAndSetProp: vi.fn().mockResolvedValue(undefined),
      scrollTarget: vi.fn().mockResolvedValue(undefined),
      isValidCSS: vi.fn().mockResolvedValue(false),
      optionalWait: vi.fn().mockResolvedValue(true),
      checkCSSSelector: vi.fn().mockResolvedValue(false),
      reload: vi.fn().mockResolvedValue(undefined),
    };
    deps = {
      helperModule: {
        Helpers: vi.fn().mockImplementation(() => mockHelper),
      },
      xpathElemToCSS: vi.fn().mockImplementation(({ selectorToCheck }) => selectorToCheck),
      interpolate: vi.fn().mockImplementation(({ stringToInterpolate }) => stringToInterpolate),
      solveCaptcha: vi.fn().mockResolvedValue(undefined),
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns false when actions is null/undefined', async () => {
    const result1 = await implementation({ inputs: {}, actions: null }, {}, ctx, deps);
    expect(result1).toBe(false);

    const result2 = await implementation({ inputs: {}, actions: undefined }, {}, ctx, deps);
    expect(result2).toBe(false);
  });

  it('returns false when actions is empty array', async () => {
    const result = await implementation({ inputs: {}, actions: [] }, {}, ctx, deps);
    expect(result).toBe(false);
  });

  it('returns false when all actions are falsy (filtered out)', async () => {
    const result = await implementation({ inputs: {}, actions: [null, undefined, false, 0, ''] }, {}, ctx, deps);
    expect(result).toBe(false);
  });

  it('executes a click action via checkAndClick', async () => {
    const actions = [
      { selectorOrXpath: 'button.submit', inputValue: null, wait: 0 },
    ];
    await implementation({ inputs: {}, actions }, {}, ctx, deps);

    expect(deps.xpathElemToCSS).toHaveBeenCalledWith(
      expect.objectContaining({ selectorToCheck: 'button.submit' }),
    );
    expect(deps.interpolate).toHaveBeenCalledWith(
      expect.objectContaining({ stringToInterpolate: 'button.submit' }),
    );
    expect(mockHelper.checkAndClick).toHaveBeenCalledWith('button.submit', '', 'CSS', null);
  });

  it('returns true after processing all actions', async () => {
    const actions = [
      { selectorOrXpath: 'button.first', inputValue: null, wait: 0 },
      { selectorOrXpath: 'button.second', inputValue: null, wait: 0 },
    ];
    const result = await implementation({ inputs: {}, actions }, {}, ctx, deps);
    expect(result).toBe(true);
    expect(mockHelper.checkAndClick).toHaveBeenCalledTimes(2);
  });
});
