// vi is available globally via vitest globals config

function createMockContext(overrides = {}) {
  return {
    evaluate: vi.fn().mockResolvedValue(null),
    click: vi.fn().mockResolvedValue(undefined),
    goto: vi.fn().mockResolvedValue({ status: 200 }),
    waitForSelector: vi.fn().mockResolvedValue(undefined),
    waitForXPath: vi.fn().mockResolvedValue(undefined),
    setInputValue: vi.fn().mockResolvedValue(undefined),
    data: vi.fn().mockResolvedValue([]),
    extract: vi.fn().mockResolvedValue([]),
    halt: vi.fn(),
    reportBlocked: vi.fn().mockResolvedValue(undefined),
    reload: vi.fn().mockResolvedValue(undefined),
    solveCaptcha: vi.fn().mockResolvedValue(true),
    setUserAgent: vi.fn(),
    setFirstRequestTimeout: vi.fn(),
    setBypassCSP: vi.fn(),
    setBlockAds: vi.fn(),
    setLoadAllResources: vi.fn(),
    setLoadImages: vi.fn(),
    setCssEnabled: vi.fn(),
    captureRequests: vi.fn(),
    cookies: vi.fn().mockResolvedValue([]),
    saveJson: vi.fn().mockResolvedValue(undefined),
    screenshot: vi.fn().mockResolvedValue('base64data'),
    evaluateInFrame: vi.fn(),
    retryContext: { maxRetries: 3, retryNumber: 1 },
    ...overrides,
  };
}

module.exports = { createMockContext };
