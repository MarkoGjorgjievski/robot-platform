const { implementation } = require('../parseURL.js');

describe('parseURL', () => {
  const mockCustomImplementation = vi.fn();

  const parse = (urlString) =>
    implementation(urlString, {}, {}, { customImplementation: mockCustomImplementation });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('parses a basic https URL correctly', async () => {
    const result = await parse('https://www.example.com/path');
    expect(result.protocol).toBe('https:');
    expect(result.hostname).toBe('www.example.com');
    expect(result.pathname).toBe('/path');
    expect(result.parsedURL).toBeInstanceOf(URL);
  });

  it('returns domain as protocol + hostname', async () => {
    const result = await parse('https://www.example.com/some/path?q=1');
    expect(result.domain).toBe('https://www.example.com');
  });

  it('parses URL with query params (search property)', async () => {
    const result = await parse('https://example.com/search?foo=bar&baz=qux');
    expect(result.search).toBe('?foo=bar&baz=qux');
  });

  it('parses URL with hash', async () => {
    const result = await parse('https://example.com/page#section');
    expect(result.hash).toBe('#section');
  });

  it('parses URL with port', async () => {
    const result = await parse('https://example.com:8080/api');
    expect(result.port).toBe('8080');
    expect(result.host).toBe('example.com:8080');
  });

  it('falls back to customImplementation when URL constructor throws', async () => {
    const fakeURL = {
      protocol: 'custom:',
      hostname: 'fake',
      host: 'fake',
      href: 'custom://fake',
      origin: 'custom://fake',
      password: '',
      pathname: '/',
      port: '',
      search: '',
      searchParams: new URLSearchParams(),
      username: '',
      hash: '',
    };
    mockCustomImplementation.mockResolvedValue(fakeURL);

    const result = await parse('not a valid url %%%');
    expect(mockCustomImplementation).toHaveBeenCalledWith('not a valid url %%%');
    expect(result.protocol).toBe('custom:');
    expect(result.hostname).toBe('fake');
  });

  it('uses default dummy:// URL when no argument is provided', async () => {
    const result = await implementation(undefined, {}, {}, { customImplementation: mockCustomImplementation });
    expect(result.protocol).toBe('dummy:');
    expect(result.href).toBe('dummy://');
  });
});
