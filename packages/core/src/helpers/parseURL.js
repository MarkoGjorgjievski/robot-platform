/**
* @param { String } inputs
* @param { Record<string, any> } parameters
* @param { ImportIO.IContext } context
*/

// parses a given URstring into a proper object

module.exports = {
  dependencies: { customImplementation: 'action:helpers/customURLImpl' },
  // eslint-disable-next-line default-param-last
  implementation: async (URLString = 'dummy://', parameters, context, { customImplementation }) => {
    let parsedURL;
    if (typeof URL !== 'undefined') {
      try {
        parsedURL = new URL(URLString);
      } catch (error) {
        parsedURL = await customImplementation(URLString);
      }
    } else {
      parsedURL = await customImplementation(URLString);
    }
    const jsonURL = ['hash', 'hostname', 'host', 'href', 'origin', 'password', 'pathname', 'port', 'protocol', 'search', 'searchParams', 'username'].reduce((acc, key) => ({ ...acc, [key]: parsedURL[key] }), {});
    return { parsedURL, ...jsonURL, domain: parsedURL.protocol && parsedURL.hostname ? `${parsedURL.protocol}//${parsedURL.hostname}` : '' };
  },
};
