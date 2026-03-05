// vi, describe, it, expect, beforeEach, afterEach are available globally via vitest config

// MUST mock navigationHelperLibrary before requiring helpers.js
vi.mock('../../navigation/navigationHelperLibrary', () => ({
  preCompileFunctions: {
    getYAMLs: vi.fn().mockResolvedValue({}),
  },
}));

const { createMockContext } = require('../../__mocks__/context');
const { implementation } = require('../append');

describe('append', () => {
  let ctx;
  let deps;

  beforeEach(() => {
    ctx = createMockContext();
    deps = {
      xpathElemToCSS: vi.fn().mockImplementation(({ selectorToCheck }) => selectorToCheck),
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns false when no append data', async () => {
    const result = await implementation({ append: null }, {}, ctx, deps);
    expect(result).toBe(false);
  });

  it('saves cookies when appendCookies is true', async () => {
    const mockCookies = [{ name: 'session', value: 'abc123' }];
    ctx.cookies.mockResolvedValue(mockCookies);

    await implementation({ appendCookies: true, append: null }, {}, ctx, deps);

    expect(ctx.cookies).toHaveBeenCalled();
    expect(ctx.saveJson).toHaveBeenCalledWith('added_cookies', mockCookies);
  });

  it('appends data from window property', async () => {
    const windowData = { price: '29.99' };
    ctx.evaluate.mockResolvedValue(windowData);

    await implementation(
      {
        append: {
          productData: { window: 'dataLayer.product' },
        },
      },
      {},
      ctx,
      deps,
    );

    expect(ctx.evaluate).toHaveBeenCalled();
    expect(ctx.saveJson).toHaveBeenCalledWith('productData', windowData);
  });

  it('appends data from input key', async () => {
    const inputs = {
      append: {
        myField: { input: 'customValue' },
      },
      customValue: { price: '29.99' },
    };

    await implementation(inputs, {}, ctx, deps);

    expect(ctx.saveJson).toHaveBeenCalledWith('myField', { price: '29.99' });
  });

  it('appends data from CSS selector', async () => {
    // Return valid JSON string so JSON.parse succeeds
    ctx.evaluate.mockResolvedValue('{"amount":"19.99"}');

    await implementation(
      {
        append: {
          extractedText: { css: 'div.price' },
        },
      },
      {},
      ctx,
      deps,
    );

    expect(deps.xpathElemToCSS).toHaveBeenCalledWith({ selectorToCheck: 'div.price' });
    expect(ctx.evaluate).toHaveBeenCalled();
    expect(ctx.saveJson).toHaveBeenCalledWith('extractedText', { amount: '19.99' });
  });
});
