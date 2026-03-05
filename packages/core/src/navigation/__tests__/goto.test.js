// vi, describe, it, expect, beforeEach, afterEach are available globally via vitest config

const { createMockContext } = require('../../__mocks__/context');
const { implementation } = require('../goto/action');

describe('goto', () => {
  let ctx;
  let deps;

  beforeEach(() => {
    ctx = createMockContext();
    deps = {
      setZipCode: vi.fn().mockResolvedValue(undefined),
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('calls context.goto with URL and default timeout', async () => {
    const inputs = { url: 'https://example.com' };
    await implementation(inputs, {}, ctx, deps);

    expect(ctx.goto).toHaveBeenCalledWith('https://example.com', {
      timeout: 10000,
      waitUntil: 'load',
      checkBlocked: true,
      captureRequests: true,
    });
  });

  it('uses custom timeout from parameters', async () => {
    const inputs = { url: 'https://example.com' };
    await implementation(inputs, { timeout: 30000 }, ctx, deps);

    expect(ctx.goto).toHaveBeenCalledWith('https://example.com', {
      timeout: 30000,
      waitUntil: 'load',
      checkBlocked: true,
      captureRequests: true,
    });
  });

  it('calls setZipCode when zipcode provided', async () => {
    const inputs = { url: 'https://example.com', zipcode: '90210' };
    await implementation(inputs, {}, ctx, deps);

    expect(deps.setZipCode).toHaveBeenCalledWith(inputs);
  });

  it('calls setZipCode when storeId provided', async () => {
    const inputs = { url: 'https://example.com', storeId: 'store-123' };
    await implementation(inputs, {}, ctx, deps);

    expect(deps.setZipCode).toHaveBeenCalledWith(inputs);
  });

  it('does not call setZipCode when neither zipcode nor storeId provided', async () => {
    const inputs = { url: 'https://example.com' };
    await implementation(inputs, {}, ctx, deps);

    expect(deps.setZipCode).not.toHaveBeenCalled();
  });
});
