import type { Page, BrowserContext } from 'playwright';
import type { RunLogger } from './logger';

type GotoOptions = {
  timeout?: number;
  waitUntil?: 'load' | 'networkidle';
  method?: string;
  referer?: string;
};

type GotoResponse = {
  headers: Record<string, string[]>;
  status: number;
  ok: boolean;
  url: string;
};

export class PlaywrightContext {
  private page: Page;
  private browserContext: BrowserContext;
  private logger: RunLogger;
  private halted = false;
  private blockAds = false;
  private blockImages = false;
  private capturedRequests: Array<{ url: string; method: string; timestamp: number }> = [];

  constructor(page: Page, browserContext: BrowserContext, logger: RunLogger) {
    this.page = page;
    this.browserContext = browserContext;
    this.logger = logger;
  }

  get isHalted() {
    return this.halted;
  }

  async goto(url: string, options: GotoOptions = {}): Promise<GotoResponse> {
    this.logger.info(`goto: ${url}`);
    const response = await this.page.goto(url, {
      timeout: options.timeout ?? 60000,
      waitUntil: options.waitUntil === 'networkidle' ? 'networkidle' : 'load',
      referer: options.referer,
    });

    const status = response?.status() ?? 0;
    const headers: Record<string, string[]> = {};
    if (response) {
      for (const [key, value] of Object.entries(response.headers())) {
        headers[key] = [value];
      }
    }

    return {
      headers,
      status,
      ok: status >= 200 && status < 300,
      url: this.page.url(),
    };
  }

  async evaluate(pageFunction: string | Function, ...args: unknown[]): Promise<unknown> {
    return this.page.evaluate(pageFunction as any, ...args);
  }

  async click(selector: string): Promise<void> {
    this.logger.info(`click: ${selector}`);
    await this.page.click(selector, { timeout: 10000 }).catch(() => {
      this.logger.warn(`click failed: ${selector}`);
    });
  }

  async setInputValue(selector: string, value: string): Promise<void> {
    this.logger.info(`setInputValue: ${selector}`);
    await this.page.fill(selector, value);
  }

  async select(selector: string, ...values: string[]): Promise<void> {
    await this.page.selectOption(selector, values);
  }

  async waitForSelector(selector: string, options?: { timeout?: number }): Promise<void> {
    await this.page.waitForSelector(selector, {
      timeout: options?.timeout ?? 30000,
    });
  }

  async waitForXPath(xpath: string, options?: { timeout?: number }): Promise<void> {
    await this.page.locator(`xpath=${xpath}`).waitFor({
      timeout: options?.timeout ?? 30000,
    });
  }

  async waitForNavigation(options?: { timeout?: number; waitUntil?: string }): Promise<() => Promise<void>> {
    const waitPromise = this.page.waitForLoadState(
      options?.waitUntil === 'networkidle' ? 'networkidle' : 'load',
      { timeout: options?.timeout ?? 30000 },
    );
    return async () => { await waitPromise; };
  }

  async waitForFunction(predicate: string | Function, options?: { timeout?: number }): Promise<void> {
    await this.page.waitForFunction(predicate as any, undefined, {
      timeout: options?.timeout ?? 30000,
    });
  }

  async waitForMutation(selector: string, options?: { timeout?: number }): Promise<void> {
    const timeout = options?.timeout ?? 30000;
    await this.page.evaluate(
      ([sel, ms]) => new Promise<void>((resolve, reject) => {
        const el = document.querySelector(sel as string);
        if (!el) { reject(new Error(`Element not found: ${sel}`)); return; }
        const timer = setTimeout(() => reject(new Error('Mutation timeout')), ms as number);
        const observer = new MutationObserver(() => {
          observer.disconnect();
          clearTimeout(timer);
          resolve();
        });
        observer.observe(el, { childList: true, subtree: true, attributes: true });
      }),
      [selector, timeout],
    );
  }

  async content(): Promise<string> {
    return this.page.content();
  }

  async stop(): Promise<void> {
    await this.page.evaluate(() => window.stop());
  }

  async screenshot(options?: { type?: string; fullPage?: boolean }): Promise<Buffer> {
    const buffer = await this.page.screenshot({
      type: (options?.type as 'png' | 'jpeg') ?? 'png',
      fullPage: options?.fullPage ?? false,
    });
    return Buffer.from(buffer);
  }

  async cookies(): Promise<Array<{ name: string; value: string; domain: string; path: string; secure: boolean; httpOnly: boolean }>> {
    const cookies = await this.browserContext.cookies();
    return cookies.map(c => ({
      name: c.name,
      value: c.value,
      domain: c.domain,
      hostOnly: !c.domain.startsWith('.'),
      path: c.path,
      secure: c.secure,
      httpOnly: c.httpOnly,
      session: c.expires === -1,
    }));
  }

  async scrollToBottom(options?: { maxScrolls?: number; stopXPath?: string; waitTime?: number }): Promise<void> {
    const maxScrolls = options?.maxScrolls ?? 1;
    const waitTime = options?.waitTime ?? 1000;
    this.logger.info(`scrollToBottom: ${maxScrolls} scrolls`);

    for (let i = 0; i < maxScrolls; i++) {
      await this.page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await this.page.waitForTimeout(waitTime);

      if (options?.stopXPath) {
        const found = await this.page.locator(`xpath=${options.stopXPath}`).count();
        if (found > 0) break;
      }
    }
  }

  async captureRequests(): Promise<void> {
    this.page.on('request', (req) => {
      this.capturedRequests.push({
        url: req.url(),
        method: req.method(),
        timestamp: Date.now(),
      });
    });
  }

  async setBypassCSP(enabled: boolean): Promise<void> {
    await this.browserContext.route('**/*', async (route) => {
      await route.continue();
    });
  }

  async setBlockAds(enabled: boolean): Promise<void> {
    this.blockAds = enabled;
    if (enabled) {
      await this.page.route('**/*', async (route) => {
        const url = route.request().url();
        const blocked = /doubleclick|googlesyndication|adservice|facebook.*pixel|analytics/i.test(url);
        if (blocked) {
          await route.abort();
        } else {
          await route.continue();
        }
      });
    }
  }

  async setLoadImages(enabled: boolean): Promise<void> {
    if (!enabled) {
      this.blockImages = true;
      await this.page.route('**/*.{png,jpg,jpeg,gif,svg,webp}', (route) => route.abort());
    }
  }

  async setLoadAllResources(enabled: boolean): Promise<void> {
    if (!enabled) {
      await this.page.route('**/*', async (route) => {
        const type = route.request().resourceType();
        if (['stylesheet', 'font', 'media'].includes(type)) {
          await route.abort();
        } else {
          await route.continue();
        }
      });
    }
  }

  async setCssEnabled(enabled: boolean): Promise<void> {
    if (!enabled) {
      await this.page.route('**/*.css', (route) => route.abort());
    }
  }

  async setUserAgent(ua: string): Promise<void> {
    this.logger.warn('setUserAgent called after page creation — not supported in MVP');
  }

  async setExtraHTTPHeaders(headers: Record<string, string>): Promise<void> {
    await this.page.setExtraHTTPHeaders(headers);
  }

  async setJavaScriptEnabled(enabled: boolean): Promise<void> {
    this.logger.warn('setJavaScriptEnabled not supported after page creation');
  }

  async setViewPort(viewport: { width: number; height: number }): Promise<void> {
    await this.page.setViewportSize(viewport);
  }

  async setFirstRequestTimeout(_ms: number): Promise<void> {
    // Handled by goto timeout — no-op in MVP
  }

  async reportBlocked(code: number, details?: string): Promise<void> {
    this.logger.error(`BLOCKED: code=${code} details=${details ?? 'none'}`);
  }

  async halt(returnExtractedData: boolean): Promise<void> {
    this.logger.info(`halt called (returnExtractedData=${returnExtractedData})`);
    this.halted = true;
  }

  async extract(_id: string): Promise<never> {
    throw new Error('extract() not implemented in MVP runner — requires YAML extraction engine');
  }

  async solveCaptcha(_options: unknown): Promise<never> {
    throw new Error('solveCaptcha() not implemented in MVP runner');
  }

  async clickAndWaitForNavigation(selector: string): Promise<void> {
    await Promise.all([
      this.page.waitForLoadState('load'),
      this.page.click(selector),
    ]);
  }

  async searchForRequest(_urlPattern: string, _method: string, _pastTimestamp: number, _timeout: number): Promise<null> {
    this.logger.warn('searchForRequest not implemented in MVP');
    return null;
  }
}
