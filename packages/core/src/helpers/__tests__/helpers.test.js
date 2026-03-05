// vi, describe, it, expect, beforeEach, afterEach are available globally via vitest config

// MUST mock navigationHelperLibrary before requiring helpers.js
// helpers.js has a top-level async IIFE that calls require('../navigation/navigationHelperLibrary')
vi.mock('../../navigation/navigationHelperLibrary', () => ({
  preCompileFunctions: {
    getYAMLs: vi.fn().mockResolvedValue({}),
  },
}));

const { Helpers } = require('../helpersIndex.js');
const { createMockContext } = require('../../__mocks__/context');

// ============================================================
// Group 1: Selector Validation (8 tests)
// ============================================================
describe('Group 1: Selector Validation', () => {
  let ctx;
  let helper;

  beforeEach(() => {
    ctx = createMockContext();
    helper = new Helpers(ctx);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('isValidCSS', () => {
    it('returns false for falsy input', async () => {
      expect(await helper.isValidCSS('')).toBe(false);
      expect(await helper.isValidCSS(null)).toBe(false);
      expect(await helper.isValidCSS(undefined)).toBe(false);
    });

    it('returns the selector string when context.evaluate returns true', async () => {
      ctx.evaluate.mockResolvedValue(true);
      const result = await helper.isValidCSS('div.test');
      expect(result).toBe('div.test');
    });

    it('returns false when context.evaluate returns false', async () => {
      ctx.evaluate.mockResolvedValue(false);
      const result = await helper.isValidCSS('div.test');
      expect(result).toBe(false);
    });
  });

  describe('isValidXpath', () => {
    it('returns false for falsy input', async () => {
      expect(await helper.isValidXpath('')).toBe(false);
      expect(await helper.isValidXpath(null)).toBe(false);
    });

    it('returns the selector string when valid', async () => {
      ctx.evaluate.mockResolvedValue(true);
      const result = await helper.isValidXpath('//div[@class="test"]');
      expect(result).toBe('//div[@class="test"]');
    });

    it('returns false when invalid', async () => {
      ctx.evaluate.mockResolvedValue(false);
      const result = await helper.isValidXpath('//div[@class="test"]');
      expect(result).toBe(false);
    });
  });

  describe('checkCSSSelector', () => {
    it('returns true when element found', async () => {
      ctx.evaluate.mockResolvedValue(true);
      const result = await helper.checkCSSSelector('div.exists');
      expect(result).toBe(true);
      expect(ctx.evaluate).toHaveBeenCalled();
    });

    it('returns false when element not found', async () => {
      ctx.evaluate.mockResolvedValue(false);
      const result = await helper.checkCSSSelector('div.missing');
      expect(result).toBe(false);
    });
  });

  describe('checkXpathSelector', () => {
    it('returns true when element found', async () => {
      ctx.evaluate.mockResolvedValue(true);
      const result = await helper.checkXpathSelector('//div');
      expect(result).toBe(true);
      expect(ctx.evaluate).toHaveBeenCalled();
    });
  });
});

// ============================================================
// Group 2: Check Methods (10 tests)
// ============================================================
describe('Group 2: Check Methods', () => {
  let ctx;
  let helper;

  beforeEach(() => {
    ctx = createMockContext();
    helper = new Helpers(ctx);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('checkSelector', () => {
    it('returns false for empty string', async () => {
      const result = await helper.checkSelector('', 'css');
      expect(result).toBe(false);
    });

    it('calls checkCSSSelector when type is css', async () => {
      ctx.evaluate.mockResolvedValue(true);
      const result = await helper.checkSelector('div.test', 'css');
      expect(result).toBe(true);
      expect(ctx.evaluate).toHaveBeenCalled();
    });

    it('calls checkXpathSelector when type is xpath', async () => {
      ctx.evaluate.mockResolvedValue(true);
      const result = await helper.checkSelector('//div', 'xpath');
      expect(result).toBe(true);
    });

    it('returns false for unknown type', async () => {
      const result = await helper.checkSelector('div.test', 'unknown');
      expect(result).toBe(false);
    });
  });

  describe('checkAndClick', () => {
    it('does nothing when selector not found', async () => {
      ctx.evaluate.mockResolvedValue(false);
      await helper.checkAndClick('div.missing', null, 'CSS');
      expect(ctx.click).not.toHaveBeenCalled();
      expect(ctx.setInputValue).not.toHaveBeenCalled();
    });

    it('clicks when no input and selector found', async () => {
      // checkSelector -> checkCSSSelector -> evaluate returns true
      // then ifThereClickOnIt -> optionalWait -> waitForSelector succeeds
      // then checkSelector again returns true, then click
      ctx.evaluate.mockResolvedValue(true);
      ctx.waitForSelector.mockResolvedValue(undefined);
      ctx.click.mockResolvedValue(undefined);
      await helper.checkAndClick('div.btn', null, 'CSS');
      expect(ctx.click).toHaveBeenCalled();
    });

    it('sets input value when input provided', async () => {
      ctx.evaluate.mockResolvedValue(true);
      ctx.setInputValue.mockResolvedValue(undefined);
      await helper.checkAndClick('input.field', 'hello', 'CSS');
      expect(ctx.setInputValue).toHaveBeenCalledWith('input.field', 'hello');
    });
  });

  describe('checkAndReturnProp', () => {
    it('returns null when selector not found', async () => {
      ctx.evaluate.mockResolvedValue(false);
      const result = await helper.checkAndReturnProp('div.missing', 'css', 'textContent');
      expect(result).toBe(null);
    });

    it('returns property value when found', async () => {
      // First call: checkSelector -> checkCSSSelector -> true
      // Second call: evaluate to get property -> 'Hello'
      ctx.evaluate
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce('Hello');
      const result = await helper.checkAndReturnProp('div.item', 'css', 'textContent');
      expect(result).toBe('Hello');
    });
  });

  describe('checkAndSetProp', () => {
    it('returns null when selector not found', async () => {
      ctx.evaluate.mockResolvedValue(false);
      const result = await helper.checkAndSetProp('div.missing', 'val', 'css', 'data-attr');
      expect(result).toBe(null);
    });

    it('returns set value when found', async () => {
      ctx.evaluate
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce('new-value');
      const result = await helper.checkAndSetProp('div.item', 'new-value', 'css', 'data-attr');
      expect(result).toBe('new-value');
    });
  });
});

// ============================================================
// Group 3: DOM Mutation (10 tests)
// ============================================================
describe('Group 3: DOM Mutation', () => {
  let ctx;
  let helper;

  beforeEach(() => {
    ctx = createMockContext();
    helper = new Helpers(ctx);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('addItemToDocument', () => {
    it('calls evaluate with key and value', async () => {
      await helper.addItemToDocument('myKey', 'myValue');
      expect(ctx.evaluate).toHaveBeenCalledTimes(1);
      const callArgs = ctx.evaluate.mock.calls[0];
      expect(callArgs[1]).toEqual({
        key: 'myKey',
        value: 'myValue',
        parentSelector: '',
        type: 'div',
        htmlString: '',
      });
    });

    it('passes parentSelector option', async () => {
      await helper.addItemToDocument('key', 'val', { parentSelector: '#parent' });
      const callArgs = ctx.evaluate.mock.calls[0];
      expect(callArgs[1].parentSelector).toBe('#parent');
    });

    it('passes type option', async () => {
      await helper.addItemToDocument('key', 'val', { type: 'span' });
      const callArgs = ctx.evaluate.mock.calls[0];
      expect(callArgs[1].type).toBe('span');
    });
  });

  describe('addArrayToDocument', () => {
    it('calls evaluate with key and values array', async () => {
      await helper.addArrayToDocument('listKey', ['a', 'b', 'c']);
      expect(ctx.evaluate).toHaveBeenCalledTimes(1);
      const callArgs = ctx.evaluate.mock.calls[0];
      expect(callArgs[1]).toEqual({
        key: 'listKey',
        values: ['a', 'b', 'c'],
        parentID: '',
        type: 'div',
        clss: '',
      });
    });

    it('passes parentID option', async () => {
      await helper.addArrayToDocument('listKey', ['x'], { parentID: '#container' });
      const callArgs = ctx.evaluate.mock.calls[0];
      expect(callArgs[1].parentID).toBe('#container');
    });
  });

  describe('addJSONURLtoDocument', () => {
    it('gets full URL when lastPartOnly is false', async () => {
      ctx.evaluate.mockResolvedValueOnce('https://example.com/path/page');
      await helper.addJSONURLtoDocument('urlKey', false);
      // Second call is from addItemToDocument
      expect(ctx.evaluate).toHaveBeenCalledTimes(2);
      const addItemArgs = ctx.evaluate.mock.calls[1];
      expect(addItemArgs[1].value).toBe('https://example.com/path/page');
    });

    it('gets last part when lastPartOnly is true', async () => {
      ctx.evaluate.mockResolvedValueOnce('https://example.com/path/page');
      await helper.addJSONURLtoDocument('urlKey', true);
      const addItemArgs = ctx.evaluate.mock.calls[1];
      expect(addItemArgs[1].value).toBe('page');
    });
  });

  describe('addURLtoDocument', () => {
    it('adds link element to head', async () => {
      ctx.evaluate.mockResolvedValueOnce('https://example.com/page');
      await helper.addURLtoDocument({ depth: 2, currentIndex: 5 });
      // First call: evaluate for URL, second call: addItemToDocument evaluate
      expect(ctx.evaluate).toHaveBeenCalledTimes(2);
      const addItemArgs = ctx.evaluate.mock.calls[1];
      expect(addItemArgs[1].parentSelector).toBe('html > head');
      expect(addItemArgs[1].type).toBe('link');
      expect(addItemArgs[1].htmlString).toContain('href="https://example.com/page"');
    });
  });
});

// ============================================================
// Group 4: Wait Methods (10 tests)
// ============================================================
describe('Group 4: Wait Methods', () => {
  let ctx;
  let helper;

  beforeEach(() => {
    ctx = createMockContext();
    helper = new Helpers(ctx);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('optionalWait', () => {
    it('returns false for falsy selector', async () => {
      expect(await helper.optionalWait('', 1000)).toBe(false);
      expect(await helper.optionalWait(null, 1000)).toBe(false);
      expect(await helper.optionalWait(undefined, 1000)).toBe(false);
    });

    it('returns true when found immediately', async () => {
      ctx.waitForSelector.mockResolvedValue(undefined);
      const result = await helper.optionalWait('div.item', 5000, 'CSS');
      expect(result).toBe(true);
    });

    it('returns false when timeout exceeded', async () => {
      ctx.waitForSelector.mockRejectedValue(new Error('Timeout'));
      const result = await helper.optionalWait('div.item', 100, 'CSS');
      expect(result).toBe(false);
    });

    it('handles long timeouts by chunking into 30s segments', async () => {
      // With 60000ms timeout, it should chunk into at least 2 calls of 30000ms each
      ctx.waitForSelector
        .mockRejectedValueOnce(new Error('Timeout'))
        .mockResolvedValueOnce(undefined);
      const result = await helper.optionalWait('div.item', 60000, 'CSS');
      expect(result).toBe(true);
      expect(ctx.waitForSelector).toHaveBeenCalledTimes(2);
      // First call should use 30000ms (hardcoded limit)
      expect(ctx.waitForSelector.mock.calls[0][1]).toEqual({ timeout: 30000 });
    });

    it('uses waitForSelector for CSS type', async () => {
      ctx.waitForSelector.mockResolvedValue(undefined);
      await helper.optionalWait('div.test', 5000, 'CSS');
      expect(ctx.waitForSelector).toHaveBeenCalled();
      expect(ctx.waitForXPath).not.toHaveBeenCalled();
    });

    it('uses waitForXPath for XPATH type', async () => {
      ctx.waitForXPath.mockResolvedValue(undefined);
      await helper.optionalWait('//div', 5000, 'XPATH');
      expect(ctx.waitForXPath).toHaveBeenCalled();
      expect(ctx.waitForSelector).not.toHaveBeenCalled();
    });
  });

  describe('waitAndCount', () => {
    it('returns 0 when element not found', async () => {
      ctx.waitForSelector.mockRejectedValue(new Error('Timeout'));
      ctx.evaluate.mockResolvedValue(false);
      const result = await helper.waitAndCount('div.missing', 100);
      expect(result).toBe(0);
    });

    it('returns count when elements found', async () => {
      ctx.waitForSelector.mockResolvedValue(undefined);
      // First evaluate: checkCSSSelector returns true
      // Second evaluate: count returns 5
      ctx.evaluate
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(5);
      const result = await helper.waitAndCount('div.items', 5000);
      expect(result).toBe(5);
    });
  });

  describe('waitToDisappear', () => {
    it('handles basic disappear case', async () => {
      // checkSelector calls evaluate; first loop iteration returns true (element is there),
      // meaning the element is present so loop continues; second returns false (gone) but
      // the while condition checks !isThere, meaning isThere=true stops the loop
      ctx.evaluate.mockResolvedValue(true);
      await helper.waitToDisappear('div.loading', { timeout: 500 });
      expect(ctx.evaluate).toHaveBeenCalled();
    });

    it('respects maxLoopIter (limit)', async () => {
      // With timeout=1000 and waitingTime=500, limit = ceil(1000/500) = 2
      // Element never disappears (evaluate returns false = not found each time)
      ctx.evaluate.mockResolvedValue(false);
      await helper.waitToDisappear('div.spinner', { timeout: 1000 });
      // Should loop at most limit=2 times (evaluate called twice for checkSelector)
      expect(ctx.evaluate).toHaveBeenCalledTimes(2);
    });
  });
});

// ============================================================
// Group 5: Scroll Methods (8 tests)
// ============================================================
describe('Group 5: Scroll Methods', () => {
  let ctx;
  let helper;

  beforeEach(() => {
    ctx = createMockContext();
    helper = new Helpers(ctx);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('scrollIntoView', () => {
    it('calls evaluate with the CSS selector', async () => {
      ctx.evaluate.mockResolvedValue(undefined);
      await helper.scrollIntoView('div.target');
      expect(ctx.evaluate).toHaveBeenCalledTimes(1);
      expect(ctx.evaluate.mock.calls[0][1]).toBe('div.target');
    });
  });

  describe('scrollBy', () => {
    it('calls evaluate with selector and coefficient', async () => {
      ctx.evaluate.mockResolvedValue(undefined);
      await helper.scrollBy('div.scroll', 2);
      expect(ctx.evaluate).toHaveBeenCalledTimes(1);
      expect(ctx.evaluate.mock.calls[0][1]).toBe('div.scroll');
      expect(ctx.evaluate.mock.calls[0][2]).toBe(2);
    });

    it('uses default coefficient of 1', async () => {
      ctx.evaluate.mockResolvedValue(undefined);
      await helper.scrollBy('div.scroll');
      expect(ctx.evaluate.mock.calls[0][2]).toBe(1);
    });
  });

  describe('scrollToElementUntil', () => {
    it('stops when stop element found', async () => {
      // optionalWait for the element: waitForSelector resolves (element exists)
      ctx.waitForSelector.mockResolvedValue(undefined);
      // scrollIntoView calls evaluate
      ctx.evaluate
        .mockResolvedValueOnce(undefined) // scrollIntoView
        .mockResolvedValueOnce(true); // checkSelector for stopXPath returns true
      await helper.scrollToElementUntil('div.scroller', '//div[@id="stop"]', { timeout: 1000, waitTime: 100 });
      // After first scroll, stop element found so loop ends
      expect(ctx.evaluate).toHaveBeenCalled();
    });

    it('respects maxLoopIter (limit based on timeout/waitTime)', async () => {
      ctx.waitForSelector.mockResolvedValue(undefined);
      // timeout=200, waitTime=100 => limit=2
      // scrollIntoView then checkSelector returns false each time
      ctx.evaluate.mockResolvedValue(false);
      await helper.scrollToElementUntil('div.scroller', '//div[@id="stop"]', { timeout: 200, waitTime: 100 });
      // 2 iterations: each iteration has scrollIntoView (evaluate) + checkSelector (evaluate)
      // = 4 evaluate calls
      expect(ctx.evaluate.mock.calls.length).toBeLessThanOrEqual(4);
    });

    it('does nothing when the scroll element does not exist', async () => {
      ctx.waitForSelector.mockRejectedValue(new Error('Timeout'));
      ctx.evaluate.mockResolvedValue(false); // checkCSSSelector returns false
      await helper.scrollToElementUntil('div.nonexistent', '//stop', { timeout: 500 });
      // optionalWait returns false, so function returns early
      // Only the waitForSelector call from optionalWait should happen
    });

    it('scrolls without stop condition when stopXPath is null', async () => {
      ctx.waitForSelector.mockResolvedValue(undefined);
      ctx.evaluate.mockResolvedValue(undefined);
      await helper.scrollToElementUntil('div.scroller', null, { timeout: 200, waitTime: 100 });
      // With no stopXPath, isStop stays false, loops run until limit
      expect(ctx.evaluate).toHaveBeenCalled();
    });

    it('uses stopCSS when stopXPath is not provided', async () => {
      ctx.waitForSelector.mockResolvedValue(undefined);
      ctx.evaluate
        .mockResolvedValueOnce(undefined) // scrollIntoView
        .mockResolvedValueOnce(true); // checkSelector for stopCSS returns true
      await helper.scrollToElementUntil('div.scroller', null, { timeout: 1000, waitTime: 100 }, 'div.stop-css');
      expect(ctx.evaluate).toHaveBeenCalled();
    });
  });
});

// ============================================================
// Group 6: Fetch Methods (8 tests)
// ============================================================
describe('Group 6: Fetch Methods', () => {
  let ctx;
  let helper;

  beforeEach(() => {
    ctx = createMockContext();
    helper = new Helpers(ctx);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('fetch', () => {
    it('calls evaluate for browser fetch', async () => {
      ctx.evaluate.mockResolvedValue({ data: 'test' });
      const result = await helper.fetch(
        'https://api.example.com/data',
        { Authorization: 'Bearer token' },
        { method: 'GET' },
        { json: true, browserFetch: false },
      );
      expect(ctx.evaluate).toHaveBeenCalled();
      expect(result).toEqual({ data: 'test' });
    });

    it('returns JSON by default', async () => {
      ctx.evaluate.mockResolvedValue({ key: 'value' });
      const result = await helper.fetch(
        'https://api.example.com',
        {},
        { method: 'GET' },
        { json: true },
      );
      expect(result).toEqual({ key: 'value' });
    });

    it('passes fetch options correctly', async () => {
      ctx.evaluate.mockResolvedValue('response');
      await helper.fetch(
        'https://api.example.com',
        { 'Content-Type': 'application/json' },
        { method: 'POST', body: '{"a":1}' },
        { text: true, json: false },
      );
      expect(ctx.evaluate).toHaveBeenCalled();
    });
  });

  describe('fetchRetry', () => {
    it('returns result on first success', async () => {
      ctx.evaluate.mockResolvedValue({ ok: true, data: 'success' });
      const result = await helper.fetchRetry(
        'https://api.example.com',
        {},
        { method: 'GET' },
        { json: true },
        3,
        (res) => res?.ok,
        10,
        { blockNThrow: false, throwErr: false },
      );
      expect(result).toEqual({ ok: true, data: 'success' });
    });

    it('retries on failure and eventually succeeds', async () => {
      ctx.evaluate
        .mockResolvedValueOnce({ ok: false })
        .mockResolvedValueOnce({ ok: true, data: 'got it' });
      const result = await helper.fetchRetry(
        'https://api.example.com',
        {},
        { method: 'GET' },
        { json: true },
        3,
        (res) => res?.ok,
        10,
        { blockNThrow: false, throwErr: false },
      );
      expect(result).toEqual({ ok: true, data: 'got it' });
    });

    it('returns false after all retries fail when blockNThrow=false and throwErr=false', async () => {
      ctx.evaluate.mockResolvedValue({ ok: false });
      const result = await helper.fetchRetry(
        'https://api.example.com',
        {},
        { method: 'GET' },
        { json: true },
        1,
        (res) => res?.ok,
        10,
        { blockNThrow: false, throwErr: false },
      );
      expect(result).toBe(false);
    });

    it('handles exceptions during fetch gracefully', async () => {
      ctx.evaluate.mockRejectedValue(new Error('Network error'));
      const result = await helper.fetchRetry(
        'https://api.example.com',
        {},
        { method: 'GET' },
        { json: true },
        0,
        (res) => res?.ok,
        10,
        { blockNThrow: false, throwErr: false },
      );
      expect(result).toBe(false);
    });

    it('calls throwError with throwNBlock when blockNThrow is true and all retries fail', async () => {
      ctx.evaluate.mockResolvedValue({ ok: false });
      // throwError will call reportBlocked and throw
      await expect(
        helper.fetchRetry(
          'https://api.example.com',
          {},
          { method: 'GET' },
          { json: true },
          0,
          (res) => res?.ok,
          10,
          { blockNThrow: true, throwErr: false },
        ),
      ).rejects.toThrow();
    });
  });
});

// ============================================================
// Group 7: Error Handling (6 tests)
// ============================================================
describe('Group 7: Error Handling', () => {
  let ctx;
  let helper;

  beforeEach(() => {
    ctx = createMockContext();
    helper = new Helpers(ctx);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('throwError', () => {
    it('throws error with message', async () => {
      await expect(helper.throwError('Something broke')).rejects.toThrow('Something broke');
    });

    it('calls reportBlocked when throwNBlock=true', async () => {
      await expect(
        helper.throwError('Blocked!', { throwNBlock: true }),
      ).rejects.toThrow('Blocked!');
      expect(ctx.reportBlocked).toHaveBeenCalledWith(503, 'Blocked!');
    });

    it('does not throw on last retry when noThrowOnLast=true', async () => {
      // retryNumber=3, maxRetries=3 => isRetryTreatedAsLast=true, shouldRetry=false
      ctx.retryContext = { maxRetries: 3, retryNumber: 3 };
      const result = await helper.throwError('Not fatal', { noThrowOnLast: true });
      // Should not throw, just console.log
      expect(result).toBeUndefined();
    });

    it('throws on non-last retry even with noThrowOnLast=true', async () => {
      ctx.retryContext = { maxRetries: 5, retryNumber: 1 };
      await expect(
        helper.throwError('Retry this', { noThrowOnLast: true }),
      ).rejects.toThrow('Retry this');
    });

    it('uses custom blockedCode', async () => {
      await expect(
        helper.throwError('Custom block', { throwNBlock: true, blockedCode: 429 }),
      ).rejects.toThrow('Custom block');
      expect(ctx.reportBlocked).toHaveBeenCalledWith(429, 'Custom block');
    });

    it('handles blockOnLast option on last retry', async () => {
      ctx.retryContext = { maxRetries: 3, retryNumber: 3 };
      await expect(
        helper.throwError('Last retry block', { blockOnLast: true }),
      ).rejects.toThrow('Last retry block');
      expect(ctx.reportBlocked).toHaveBeenCalledWith(503, 'Last retry block');
    });
  });
});

// ============================================================
// Group 8: Utility Methods (10 tests)
// ============================================================
describe('Group 8: Utility Methods', () => {
  let ctx;
  let helper;

  beforeEach(() => {
    ctx = createMockContext();
    helper = new Helpers(ctx);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('reload', () => {
    it('calls context.reload', async () => {
      await helper.reload(10);
      expect(ctx.reload).toHaveBeenCalledTimes(1);
    });

    it('waits after reload', async () => {
      const start = Date.now();
      await helper.reload(50);
      const elapsed = Date.now() - start;
      expect(elapsed).toBeGreaterThanOrEqual(40);
    });
  });

  describe('make_opt_tags', () => {
    it('returns empty string when no opt tags', async () => {
      const result = await helper.make_opt_tags({});
      expect(result).toBe('');
    });

    it('returns formatted string with optTags', async () => {
      const result = await helper.make_opt_tags({ optTags: '"custom": true' });
      expect(result).toBe('#[!opt!]{"custom": true}[/!opt!]');
    });

    it('includes applyIgnoreVBAndCookies', async () => {
      const result = await helper.make_opt_tags({ applyIgnoreVBAndCookies: true });
      expect(result).toContain('"cookies":[],"storage":{}');
    });

    it('includes turnOffTableNormalize', async () => {
      const result = await helper.make_opt_tags({ turnOffTableNormalize: true });
      expect(result).toContain('"table_normalize": false');
    });
  });

  describe('ifThereClickOnIt', () => {
    it('returns immediately for falsy selector', async () => {
      const result = await helper.ifThereClickOnIt('');
      expect(result).toBeUndefined();
      expect(ctx.click).not.toHaveBeenCalled();
    });

    it('returns false when element not found after wait', async () => {
      ctx.waitForSelector.mockRejectedValue(new Error('Timeout'));
      ctx.evaluate.mockResolvedValue(false);
      const result = await helper.ifThereClickOnIt('div.missing', 100);
      expect(result).toBe(false);
    });

    it('clicks when element found', async () => {
      ctx.waitForSelector.mockResolvedValue(undefined);
      ctx.evaluate.mockResolvedValue(true);
      ctx.click.mockResolvedValue(undefined);
      const result = await helper.ifThereClickOnIt('div.btn', 100);
      expect(result).toBe(true);
      expect(ctx.click).toHaveBeenCalled();
    });
  });

  describe('getAllXPaths', () => {
    it('returns xpaths from nested data structure', () => {
      const rawData = [
        {
          data: [
            {
              xpath: '//body',
              group: [
                {
                  field1: [{ xpath: '//div[1]' }],
                  field2: [{ xpath: '//div[2]' }],
                },
              ],
            },
          ],
        },
      ];
      const result = helper.getAllXPaths(rawData);
      expect(result).toEqual([
        { '//body': ['//div[1]', '//div[2]'] },
      ]);
    });

    it('handles empty data', () => {
      const result = helper.getAllXPaths([]);
      expect(result).toEqual([]);
    });
  });

  describe('checkURLFor', () => {
    it('returns true when substring found', async () => {
      ctx.evaluate.mockReturnValue('https://example.com/products/page');
      const result = await helper.checkURLFor('products');
      expect(result).toBe(true);
    });

    it('returns false when substring not found', async () => {
      ctx.evaluate.mockReturnValue('https://example.com/home');
      const result = await helper.checkURLFor('products');
      expect(result).toBe(false);
    });
  });
});

// ============================================================
// Group 9: Misc (10 tests)
// ============================================================
describe('Group 9: Misc', () => {
  let ctx;
  let helper;

  beforeEach(() => {
    ctx = createMockContext();
    helper = new Helpers(ctx);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('addAttributeToMatches', () => {
    it('calls evaluate with CSS selector', async () => {
      ctx.evaluate.mockResolvedValue(undefined);
      await helper.addAttributeToMatches({ css: 'div.item', attribute: 'data-x=1' });
      expect(ctx.evaluate).toHaveBeenCalledTimes(1);
    });

    it('calls evaluate with XPath', async () => {
      ctx.evaluate.mockResolvedValue(undefined);
      await helper.addAttributeToMatches({ xpath: '//div', attribute: 'data-x=1' });
      expect(ctx.evaluate).toHaveBeenCalledTimes(1);
    });
  });

  describe('hijackRequests', () => {
    it('calls evaluate to monkey-patch XMLHttpRequest', async () => {
      ctx.evaluate.mockResolvedValue(undefined);
      await helper.hijackRequests(false);
      expect(ctx.evaluate).toHaveBeenCalledTimes(1);
      // The first argument should be a function
      expect(typeof ctx.evaluate.mock.calls[0][0]).toBe('function');
      // The second argument should be restoreAfterCatch
      expect(ctx.evaluate.mock.calls[0][1]).toBe(false);
    });

    it('passes restoreAfterCatch=true', async () => {
      ctx.evaluate.mockResolvedValue(undefined);
      await helper.hijackRequests(true);
      expect(ctx.evaluate.mock.calls[0][1]).toBe(true);
    });
  });

  describe('randomClick', () => {
    it('calls ifThereClickOnIt with a selector from the array', async () => {
      ctx.waitForSelector.mockResolvedValue(undefined);
      ctx.evaluate.mockResolvedValue(true);
      ctx.click.mockResolvedValue(undefined);
      // randomClick calls ifThereClickOnIt which eventually calls click
      await helper.randomClick(['sel1', 'sel2', 'sel3']);
      // We can't predict which selector, but click path should be invoked
      // randomClick doesn't await, so we just check it doesn't throw
    });
  });

  describe('moveShadowToMainDom', () => {
    it('calls evaluate to move shadow DOM content', async () => {
      ctx.waitForSelector.mockResolvedValue(undefined);
      ctx.evaluate.mockResolvedValue(undefined);
      await helper.moveShadowToMainDom('div.shadow-host', 0);
      // optionalWait calls waitForSelector, then evaluate is called for the DOM manipulation
      expect(ctx.evaluate).toHaveBeenCalled();
      const callArgs = ctx.evaluate.mock.calls[0];
      expect(callArgs[1]).toEqual({ selector: 'div.shadow-host', ind: 0 });
    });

    it('returns false when element not found', async () => {
      ctx.waitForSelector.mockRejectedValue(new Error('Timeout'));
      ctx.evaluate.mockResolvedValue(false);
      const result = await helper.moveShadowToMainDom('div.missing', 0);
      expect(result).toBe(false);
    });
  });

  describe('removeScriptsWhichContains', () => {
    it('calls evaluate with the text to match', async () => {
      ctx.evaluate.mockResolvedValue(undefined);
      await helper.removeScriptsWhichContains('analytics');
      expect(ctx.evaluate).toHaveBeenCalledTimes(1);
      expect(ctx.evaluate.mock.calls[0][1]).toBe('analytics');
    });
  });

  describe('dropDownValue', () => {
    it('calls evaluate to select dropdown option', async () => {
      // checkSelector -> checkCSSSelector -> evaluate returns true
      // then evaluate for dropdown selection
      ctx.evaluate
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(true);
      await helper.dropDownValue('select.size', 'Large');
      expect(ctx.evaluate).toHaveBeenCalledTimes(2);
      expect(ctx.evaluate.mock.calls[1][1]).toBe('select.size');
      expect(ctx.evaluate.mock.calls[1][2]).toBe('Large');
    });

    it('does nothing when selector not found', async () => {
      ctx.evaluate.mockResolvedValue(false);
      await helper.dropDownValue('select.missing', 'Large');
      // Only one evaluate call for checkCSSSelector
      expect(ctx.evaluate).toHaveBeenCalledTimes(1);
    });
  });
});
