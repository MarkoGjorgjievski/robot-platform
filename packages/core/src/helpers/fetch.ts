import { throwError } from './misc.ts';

declare const extractorContext: any;

interface FetchOptions {
  method?: string;
  mode?: string;
  credentials?: string;
  redirect?: string;
  body?: any;
  headers?: string | Record<string, string>;
  [key: string]: any;
}

interface ReturnObj {
  text?: boolean;
  json?: boolean;
  browserFetch?: boolean;
  useLambda?: string;
}

// function which makes a backend fetch
export async function backendFetch(context: any, url: string, options: FetchOptions, useLambda: string) {
  if (useLambda === 'None') return await extractorContext.fetch(url, options);
  const headers = typeof options.headers === 'string' ? options.headers : JSON.stringify(options.headers);
  const body = JSON.stringify({ url, ...options, headers });
  let optn: any;
  let endpoint: string | undefined;
  if (useLambda === 'Windmill') {
    const apiKey = 'be3acd62c4154633ad79a9e95a058d4b2040c1fc43cc2c03f5a34366f3cd9cbd661e7f5a48a4b3ba7a08e8d447af85475ea56c2f1f15a5214c8b1a47ed9d652ff6cf32cab46f94cb52483c9cccf099b0';
    endpoint = `https://wm2.import.io/api/w/importio/jobs/run_wait_result/p/f/importio/naver?_apikey=${apiKey}`;
    optn = {
      ...options,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer 6vRr62th3LDnKaq9tZDGk2BT7XagaWdk',
      },
      body,
    };
  }
  if (useLambda === 'AWS') {
    endpoint = 'https://nofpyo6ehf.execute-api.us-east-2.amazonaws.com/default/go-naver-lambda';
    optn = {
      ...options,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    };
  }
  console.log(`The fetch is called with options: ${JSON.stringify(optn)}`);
  return await extractorContext.fetch(endpoint, optn).then((res: any) => res.text()).then((txt: string) => ({
    text: () => {
      try {
        const parsed = JSON.parse(txt);
        if (typeof parsed === 'string') return parsed;
        if (typeof parsed === 'object') return txt;
        return parsed;
      } catch (error) {
        return txt;
      }
    },
    json: () => JSON.parse(txt),
  }));
}

export async function helperFetch(context: any, url: string, headers: any, {
  method = 'GET', mode = 'cors', credentials = 'include', redirect = 'follow', body, ...rest
}: FetchOptions, { text = false, json = true, browserFetch = false, useLambda = 'None' }: ReturnObj) {
  const fetchOptions: FetchOptions = browserFetch ? {
    method, mode, credentials, redirect, body, ...rest,
  } : { method, headers, body, ...rest };
  const lambdaStr = useLambda !== 'None' ? ` --using lambda ${useLambda}` : '';
  console.log(`Using ${browserFetch ? 'front' : 'back'}-end fetch: ${method}${lambdaStr}`, { headers, ...fetchOptions });
  if (typeof extractorContext !== 'undefined' && !browserFetch) {
    return await backendFetch(context, url, fetchOptions, useLambda).then((r: any) => {
      if (text) return r.text();
      if (json) return r.json();
      return r;
    });
  }
  return await context.evaluate((url: string, headers: any, fetchObj: any, { text, json }: { text: boolean; json: boolean }) => {
    try {
      return fetch(url, { headers: new Headers(headers), ...fetchObj }).catch((e: any) => {
        console.log('Something happened 1');
        console.log(e);
        return e;
      }).then((r: any) => {
        if (text) return r.text();
        if (json) return r.json();
        return r;
      })
        .catch((e: any) => {
          console.log('Something happened 2');
          console.log(e);
          return e;
        });
    } catch (error) {
      console.log('Something happened 3');
      console.log(error);
      return null;
    }
  }, url, headers, fetchOptions, { text, json }).catch((e: any) => {
    console.log('Something happened 3');
    console.log(e);
    return e;
  });
}

export async function fetchRetry(
  context: any,
  url: string,
  headers: any,
  options: FetchOptions,
  returnObj: ReturnObj,
  retries: number = 1,
  successCallback: (res: any) => any = res => res?.ok,
  waitingTime: number = 1000,
  { blockNThrow = true, throwErr = false }: { blockNThrow?: boolean; throwErr?: boolean } = {},
) {
  let index = 0;
  while (index <= retries) {
    index += 1;
    console.log(`Calling fetch nb: ${index} to url: ${url}, ${JSON.stringify(returnObj)}`);
    if (Object.keys(headers || {}).length) {
      console.log('Headers: ');
      console.log(headers);
    }
    if (options.body) {
      console.log('Body as string: ');
      console.log(options.body);
    }
    try {
      const result = await helperFetch(context, url, headers, options, returnObj).catch(console.log);
      console.log('Fetch finsihed and produced: (next log may not display if too big)');
      console.log(result);
      console.log('result truncated', `${result}`.slice(0, 10));
      if (await successCallback(result)) return result;
      console.log(`fetch didn't succeed for retry: ${index} - success callback failed`);
      await new Promise(resolve => setTimeout(resolve, waitingTime));
    } catch (error) {
      console.log(`fetch didn't succeed for retry: ${index}`, error);
      await new Promise(resolve => setTimeout(resolve, waitingTime));
    }
  }
  if (throwErr) await throwError(context, 'Fetch failed');
  if (blockNThrow) await throwError(context, 'Fetch failed, showing block', { throwNBlock: true });
  return false;
}

