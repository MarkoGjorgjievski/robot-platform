/**
* @param { String } inputs
* @param { Record<string, any> } parameters
* @param { ImportIO.IContext } context
*/

// parses a given URstring into a proper object

export interface CustomURL {
  hash: string;
  hostname: string;
  host: string;
  href: string;
  protocol: string;
  queryObj: Record<string, string>;
  readonly origin: string;
  readonly pathname: string;
  readonly searchParams: {
    append: () => void;
    delete: (name: string) => void;
    entries: () => void;
    forEach: () => void;
    get: () => void;
    getAll: () => void;
    has: () => void;
    keys: () => string[];
    set: (name: string, value: string) => void;
    sort: () => void;
    toString: () => void;
    values: () => void;
  };
  readonly search: string;
}

export const implementation = (strToParse: string): CustomURL => {
  const notSupported = () => console.log('Not supported');
  return {
    hash: strToParse?.split('#')?.slice(1)?.join('#') ? `#${strToParse?.split('#')?.slice(1)?.join('#')}` : '',
    hostname: strToParse?.split('/')?.[2] || '', // does not extract port and port number
    host: strToParse?.split('/')?.[2] || '', // does not support port and port number
    href: strToParse,
    protocol: strToParse?.split('/')?.[0],
    queryObj: Object.fromEntries(strToParse
      ?.split('?')?.slice(1)?.join('?')
      ?.replace(strToParse?.split('#')?.slice(1)?.join('#') ? `#${strToParse?.split('#')?.slice(1)?.join('#')}` : '', '')
      ?.split('&')
      ?.map(el => el?.split('='))),
    get origin() {
      return `${this.protocol}//${this.host}`;
    },
    get pathname() {
      return this.href?.replace(this.origin, '')?.replace(this.hash, '')?.split('?')?.[0];
    },
    get searchParams() {
      return {
        append: notSupported,
        delete: (name: string) => {
          this.queryObj[name] = null as unknown as string;
          delete this.queryObj[name];
        },
        entries: notSupported,
        forEach: notSupported,
        get: notSupported,
        getAll: notSupported,
        has: notSupported,
        keys: () => Object.keys(this.queryObj),
        // eslint-disable-next-line no-return-assign
        set: (name: string, value: string) => this.queryObj[name] = value,
        sort: notSupported,
        toString: notSupported,
        values: notSupported,
      };
    },
    get search() {
      const str = Object.entries(this.queryObj || {}).map(elArr => elArr?.join('='))?.join('&');
      return str?.length ? `?${str}` : '';
    },
  } as CustomURL;
};

export default {
  implementation,
};
