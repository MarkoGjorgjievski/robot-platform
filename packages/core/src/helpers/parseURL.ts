/**
* @param { String } inputs
* @param { Record<string, any> } parameters
* @param { ImportIO.IContext } context
*/

// parses a given URstring into a proper object

export interface ParsedURLResult {
  parsedURL: URL | Record<string, unknown>;
  hash: string;
  hostname: string;
  host: string;
  href: string;
  origin: string;
  password: string;
  pathname: string;
  port: string;
  protocol: string;
  search: string;
  searchParams: URLSearchParams | Record<string, unknown>;
  username: string;
  domain: string;
}

interface Dependencies {
  customImplementation: (urlString: string) => Promise<Record<string, unknown>> | Record<string, unknown>;
}

export const dependencies = { customImplementation: 'action:helpers/customURLImpl' };

// eslint-disable-next-line default-param-last
export const implementation = async (
  URLString: string = 'dummy://',
  parameters: Record<string, unknown>,
  context: Record<string, unknown>,
  { customImplementation }: Dependencies,
): Promise<ParsedURLResult> => {
  let parsedURL: URL | Record<string, unknown>;
  if (typeof URL !== 'undefined') {
    try {
      parsedURL = new URL(URLString);
    } catch (error) {
      parsedURL = await customImplementation(URLString);
    }
  } else {
    parsedURL = await customImplementation(URLString);
  }
  const jsonURL = ['hash', 'hostname', 'host', 'href', 'origin', 'password', 'pathname', 'port', 'protocol', 'search', 'searchParams', 'username'].reduce((acc, key) => ({ ...acc, [key]: (parsedURL as Record<string, unknown>)[key] }), {} as Record<string, unknown>);
  return { parsedURL, ...jsonURL, domain: (parsedURL as Record<string, unknown>).protocol && (parsedURL as Record<string, unknown>).hostname ? `${(parsedURL as Record<string, unknown>).protocol}//${(parsedURL as Record<string, unknown>).hostname}` : '' } as ParsedURLResult;
};

export default {
  dependencies,
  implementation,
};
