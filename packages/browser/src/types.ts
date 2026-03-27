export type InterceptedRequest = {
  url: string;
  method: string;
  resourceType: string;
  responseStatus: number;
  responseHeaders: Record<string, string>;
  responseBody: string | null;
  contentType: string | null;
  bodySize: number;
  isJson: boolean;
  parsedJson: unknown | null;
  timestamp: number;
};

export type StructuredData = {
  ldJson: Record<string, unknown>[];
  nextData: Record<string, unknown> | null;
  initialState: Record<string, unknown> | null;
  meta: Record<string, string>;
};

export type PageCapture = {
  url: string;
  html: string;
  markdown: string;
  screenshot: Buffer;
  title: string;
  timestamp: number;
  structuredData: StructuredData;
  interceptedRequests: InterceptedRequest[];
};

export type BrowserOptions = {
  headless?: boolean;
  blockAds?: boolean;
  blockImages?: boolean;
  viewport?: { width: number; height: number };
  userAgent?: string;
  timeout?: number;
};

export type CaptureOptions = {
  waitUntil?: 'load' | 'networkidle' | 'domcontentloaded';
  screenshotFullPage?: boolean;
  interceptNetworkRequests?: boolean;
  timeout?: number;
};

export interface IBrowser {
  launch(options?: BrowserOptions): Promise<void>;
  capture(url: string, options?: CaptureOptions): Promise<PageCapture>;
  evaluate<T = unknown>(url: string, script: string, options?: CaptureOptions): Promise<T>;
  close(): Promise<void>;
}
