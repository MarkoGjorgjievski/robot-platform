const { implementation } = require('../inputInterpolation.js');

describe('inputInterpolation', () => {
  const mockParseURL = vi.fn();
  const mockGenerateSlug = vi.fn(() => 'mock-random-slug');

  const defaultParsedURL = {
    domain: 'https://example.com',
    protocol: 'https:',
    hostname: 'example.com',
    origin: 'https://example.com',
    pathname: '/path',
    search: '?q=test',
    host: 'example.com',
    hash: '',
    href: 'https://example.com/path?q=test',
  };

  const dependencies = {
    randomizer: { Randomizer: { generateSlug: mockGenerateSlug } },
    wordList: { wordList: { list: ['mock'], cumulFrequency: [1] } },
    parseURL: mockParseURL,
  };

  const defaultInputs = {
    url: 'https://example.com/path?q=test',
    previousURL: 'https://previous.com',
  };

  const interpolate = (opts) =>
    implementation(
      { inputs: defaultInputs, removeUnused: true, ...opts },
      {},
      {},
      dependencies,
    );

  beforeEach(() => {
    vi.clearAllMocks();
    mockParseURL.mockResolvedValue(defaultParsedURL);
  });

  it('returns empty string when stringToInterpolate is falsy', async () => {
    expect(await interpolate({ stringToInterpolate: '' })).toBe('');
    expect(await interpolate({ stringToInterpolate: null })).toBe('');
    expect(await interpolate({ stringToInterpolate: undefined })).toBe('');
  });

  it('replaces input keys in template string', async () => {
    const inputs = { ...defaultInputs, title: 'My Title', category: 'Books' };
    const result = await interpolate({
      inputs,
      stringToInterpolate: 'https://site.com/{title}/{category}',
    });
    expect(result).toBe('https://site.com/My Title/Books');
  });

  it('replaces {today} with ISO date', async () => {
    const result = await interpolate({
      stringToInterpolate: 'https://example.com/{today}',
    });
    const expectedDate = new Date().toISOString().split('T')[0];
    expect(result).toBe(`https://example.com/${expectedDate}`);
  });

  it('replaces {year}, {month}, {day} with date components', async () => {
    const result = await interpolate({
      stringToInterpolate: '{year}-{month}-{day}',
      inputs: { ...defaultInputs, prependDomain: 'https://example.com' },
    });
    const now = new Date();
    expect(result).toContain(String(now.getFullYear()));
    expect(result).toContain(String(now.getMonth() + 1));
    expect(result).toContain(String(now.getDay()));
  });

  it('replaces {queryParams} from URL', async () => {
    const result = await interpolate({
      stringToInterpolate: 'https://example.com/search?{queryParams}',
    });
    expect(result).toBe('https://example.com/search?q=test');
  });

  it('replaces {urlNoQuery} with origin+pathname', async () => {
    const result = await interpolate({
      stringToInterpolate: 'https://example.com/go?ref={urlNoQuery}',
    });
    expect(result).toBe('https://example.com/go?ref=https://example.com/path');
  });

  it('removes unused placeholders when removeUnused=true', async () => {
    const result = await interpolate({
      stringToInterpolate: 'https://example.com/{unknownKey}/page',
      removeUnused: true,
    });
    expect(result).toBe('https://example.com//page');
    expect(result).not.toContain('{unknownKey}');
  });

  it('keeps unused placeholders when removeUnused=false', async () => {
    const result = await interpolate({
      stringToInterpolate: 'https://example.com/{unknownKey}/page',
      removeUnused: false,
    });
    expect(result).toContain('{unknownKey}');
  });

  it('encodes values when encode=true', async () => {
    const inputs = { ...defaultInputs, title: 'hello world' };
    const result = await interpolate({
      inputs,
      stringToInterpolate: 'https://example.com/{title}',
      encode: true,
    });
    expect(result).toBe('https://example.com/hello%20world');
  });

  it('does NOT encode URL-like keys even when encode=true', async () => {
    const inputs = { ...defaultInputs, redirectUrl: 'https://redirect.com/path?a=1' };
    const result = await interpolate({
      inputs,
      stringToInterpolate: 'https://example.com/go?target={redirectUrl}',
      encode: true,
    });
    // URL-like keys (ending with "url" or starting with "url") should not be encoded
    expect(result).toContain('https://redirect.com/path?a=1');
    expect(result).not.toContain('https%3A%2F%2Fredirect.com');
  });

  it('replaces {host} with domain when string does not start with http', async () => {
    mockParseURL.mockImplementation(async (str) => {
      if (str === 'https://previous.com') {
        return { domain: 'https://previous.com', origin: 'https://previous.com', pathname: '/', search: '', host: 'previous.com' };
      }
      return defaultParsedURL;
    });

    const result = await interpolate({
      inputs: { ...defaultInputs },
      stringToInterpolate: '{host}/some/path',
    });
    expect(result).toBe('https://previous.com/some/path');
  });
});
