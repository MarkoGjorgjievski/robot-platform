// vi, describe, it, expect, beforeEach, afterEach are available globally via vitest config

// Mock navigationHelperLibrary BEFORE any require that triggers its loading
vi.mock('../../navigation/navigationHelperLibrary', () => ({
  preCompileFunctions: {
    getRobotTemplateName: vi.fn().mockReturnValue('robots/san-antonio'),
    getYAMLs: vi.fn().mockResolvedValue({}),
    getAllYAMLFilePaths: vi.fn().mockReturnValue([]),
    getCLIParams: vi.fn().mockReturnValue({}),
    getFolderPath: vi.fn().mockReturnValue(''),
  },
}));

// Also mock the path used by goto2's own require('../navigationHelperLibrary')
vi.mock('../navigationHelperLibrary', () => ({
  preCompileFunctions: {
    getRobotTemplateName: vi.fn().mockReturnValue('robots/san-antonio'),
    getYAMLs: vi.fn().mockResolvedValue({}),
    getAllYAMLFilePaths: vi.fn().mockReturnValue([]),
    getCLIParams: vi.fn().mockReturnValue({}),
    getFolderPath: vi.fn().mockReturnValue(''),
  },
}));

const { createMockContext } = require('../../__mocks__/context');
const { implementation } = require('../goto2/action');

describe('goto2', () => {
  let ctx;
  let mockHelper;
  let deps;

  beforeEach(() => {
    ctx = createMockContext();
    mockHelper = {
      make_opt_tags: vi.fn().mockResolvedValue(''),
      ifThereClickOnIt: vi.fn().mockResolvedValue(undefined),
      optionalWait: vi.fn().mockResolvedValue(true),
      gotoWithCaptchaSolver: vi.fn().mockResolvedValue(undefined),
    };
    deps = {
      helperModule: {
        Helpers: vi.fn().mockImplementation(() => mockHelper),
      },
      captchaSolversModule: {
        Solvers: {
          getSolvers: vi.fn().mockResolvedValue({}),
        },
      },
      gotoSolver: vi.fn().mockResolvedValue(undefined),
      fetchGoto: vi.fn().mockResolvedValue(undefined),
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sets browser configuration (setBypassCSP, setBlockAds, etc.)', async () => {
    const inputs = { url: 'https://example.com' };
    await implementation(inputs, {}, ctx, deps);

    expect(ctx.setBypassCSP).toHaveBeenCalledWith(true);
    expect(ctx.setBlockAds).toHaveBeenCalledWith(true);
    expect(ctx.setLoadAllResources).toHaveBeenCalledWith(false);
    expect(ctx.setLoadImages).toHaveBeenCalledWith(false);
    expect(ctx.setCssEnabled).toHaveBeenCalledWith(false);
  });

  it('calls gotoSolver by default (not fetchGoto)', async () => {
    const inputs = { url: 'https://example.com' };
    await implementation(inputs, {}, ctx, deps);

    expect(deps.gotoSolver).toHaveBeenCalled();
    expect(deps.fetchGoto).not.toHaveBeenCalled();
  });

  it('calls fetchGoto when useFetch=true', async () => {
    const inputs = { url: 'https://example.com' };
    await implementation(inputs, { useFetch: true }, ctx, deps);

    expect(deps.fetchGoto).toHaveBeenCalled();
    expect(deps.gotoSolver).not.toHaveBeenCalled();
  });

  it('returns newGoto2 object with merged parameters', async () => {
    const inputs = { url: 'https://example.com' };
    const result = await implementation(inputs, { timeout: 30000 }, ctx, deps);

    expect(result).toBeDefined();
    expect(result.url).toBe('https://example.com');
    expect(result.timeout).toBe(30000);
    expect(result.inputs).toBe(inputs);
    expect(result.gotoOptions).toBeDefined();
  });

  it('retries goto when retryGotoUntilLoadedCSSorXpath=true and first attempt fails', async () => {
    mockHelper.optionalWait
      .mockResolvedValueOnce(false) // first attempt: loaded selector not found
      .mockResolvedValueOnce(true); // second attempt: loaded selector found

    const inputs = { url: 'https://example.com', loadedSelector: 'div.content' };
    const params = { retryGotoUntilLoadedCSSorXpath: true, gotoRetries: 2 };
    await implementation(inputs, params, ctx, deps);

    expect(deps.gotoSolver).toHaveBeenCalledTimes(2);
    expect(mockHelper.optionalWait).toHaveBeenCalledTimes(2);
  });

  it('accepts cookies when acceptCookiesCSSSelector provided', async () => {
    const inputs = { url: 'https://example.com' };
    const params = { acceptCookiesCSSSelector: 'button.accept-cookies' };
    await implementation(inputs, params, ctx, deps);

    expect(mockHelper.ifThereClickOnIt).toHaveBeenCalledWith('button.accept-cookies', 3000);
  });

  it('calls context.captureRequests when captureRequests=true', async () => {
    const inputs = { url: 'https://example.com' };
    const params = { captureRequests: true };
    await implementation(inputs, params, ctx, deps);

    expect(ctx.captureRequests).toHaveBeenCalled();
  });

  it('calls context.setFirstRequestTimeout with parameter value', async () => {
    const inputs = { url: 'https://example.com' };
    const params = { firstRequestTimeout: 45000 };
    await implementation(inputs, params, ctx, deps);

    expect(ctx.setFirstRequestTimeout).toHaveBeenCalledWith(45000);
  });
});
