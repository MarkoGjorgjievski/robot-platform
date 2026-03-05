/**
 *
 * @param { { id: any } } inputs
 * @param { { domain: string, prefix?: string, suffix?: string, url?: string } } parameters
 * @param { ImportIO.IContext } context
 * @param { { } } dependencies
 */

module.exports = {
  dependencies: { helperModule: 'module:helpers/helpers' },
  implementation: async ({ inputs, options }, parameters, context, dependencies) => {
    const { url, goto2, id, fetchErrorStringStart } = inputs;
    const {
      timeout, /* gotoRetries = 1 , */ rawOptions = {}, browserFetch, useLambda, fromAboutBlank, injectedID,
    } = options;
    const { helperModule: { Helpers } } = dependencies;
    const helper = new Helpers(context);

    let optTags;
    try {
      optTags = JSON.parse(url.includes('#[!opt!]') ? url.split('#[!opt!]').pop().split('[/!opt!]').shift() : `{${goto2.optTags || ''}}`);
    } catch (error) {
      console.log(url, goto2.optTags);
      throw new Error(error);
    }

    const { http_method: httpMethod, headers: headerOpt } = optTags;
    const cookies = {
      ...(optTags?.headers?.cookies || optTags?.headers?.Cookies || optTags?.headers?.cookie || optTags?.headers?.Cookie),
      ...Object.fromEntries((rawOptions.cookies || [])?.map(({ name, value }) => [name, value])),
      ...Object.fromEntries((optTags.cookies || [])?.map(({ name, value }) => [name, value])),
    };

    // make body
    const optBody = optTags.body || optTags.formdata || optTags.jsondata;
    const hasBody = optBody != null;
    let body;
    try {
      body = hasBody && typeof optBody !== 'string' ? JSON.stringify(optBody) : optBody;
    } catch (error) {
      console.log(optBody, typeof optBody);
      throw new Error(error);
    }

    // prepare cookies
    const hasCookies = Object.keys(cookies).length;
    const cookieHeader = (hasCookies ? { Cookie: Object.entries(cookies).map(([key, val]) => `${key}=${val}`).join('; ') } : {});
    const credentials = hasCookies ? { credentials: 'include' } : {};

    // prepare headers
    const headers = { ...headerOpt, ...(rawOptions?.headers || {}), ...cookieHeader };

    // auto set method
    const method = httpMethod || (hasBody ? 'POST' : 'GET');

    if (fromAboutBlank) await context.goto('about:blank', { timeout, waitUntil: 'load', checkBlocked: false, captureRequests: true });

    const response = await helper.fetchRetry(
      url,
      headers,
      {
        timeout, method, ...(hasBody ? { body } : {}), ...credentials, tracingID: id,
      },
      { text: true, json: false, browserFetch, useLambda },
      0,
      res => res != null && (!fetchErrorStringStart || typeof res !== 'string' || (fetchErrorStringStart && !res.startsWith(fetchErrorStringStart))),
      timeout,
      { blockNThrow: false, throwErr: false },
    );

    const html = response === false ? 'failed' : response;

    const idTag = injectedID ? ` id="${injectedID}"` : ' id="addedByFetchGoto"';

    await context.evaluate((str, urlVal, idStr) => {
      const toInsert = str || 'empty';
      const htmlDoc = '<!doctype html>';
      const addMetaUrl = () => {
        document.head.insertAdjacentHTML('afterbegin', `<meta name="fetchURL" content="${urlVal}"${idStr}>`);
      };

      if (str?.toLowerCase().startsWith(htmlDoc)) {
        document.write(toInsert);
        document.close();
        addMetaUrl();
      } else if (str?.toLowerCase()?.startsWith('<html')) {
        document.write(htmlDoc + toInsert);
        document.close();
        addMetaUrl();
      } else {
        document.body.insertAdjacentHTML('afterbegin', `<pre${idStr}>${toInsert}</pre><div class="json-formatter-container"></div>`);
        addMetaUrl();
      }
    }, html, url, idTag);
  },
};
