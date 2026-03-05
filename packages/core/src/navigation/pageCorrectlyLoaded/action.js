/* eslint-disable no-return-await */
/**
* @param {{ loadedSelector: string, noResultsXPath: string }} inputs
* @param { Record<string, any> } parameters
* @param { ImportIO.IContext } context
* @param { Record<string, any> } dependencies
*/

module.exports = {
  implementation: async (inputs, parameters, context) => {
    const {
      loadedSelector, noResultsXPath, returnDataWhenHalt, loadedXpath,
      accessDeniedXPath,
      loadingTimeout = 5000,
    } = inputs;
    const loadedSelectorOrXpath = loadedXpath || loadedSelector;
    const intLoadingTimeout = parseInt(loadingTimeout, 10);
    await context[loadedXpath ? 'waitForXPath' : 'waitForSelector'](loadedSelectorOrXpath, { timeout: intLoadingTimeout })
      .catch(async () => {
        // The loaded selector is not found, we will check for all the other selectors
        console.log(`The loadedSelector: ${loadedSelectorOrXpath} was not found on the page.`);
        return await context.waitForXPath(noResultsXPath, { timeout: intLoadingTimeout })
          .catch(() => context.waitForXPath(accessDeniedXPath, { timeout: intLoadingTimeout })
            .catch(() => {
              // none of the 3 selectors are found
              throw new Error('Page not loaded correctly, change the 3 load selectors to remove this error.');
            })
            .then(async () => {
              // case where the accessDeniedXPath is found but not the others, reportBlocked is like throwing an error
              console.log(`The accessDeniedXPath: ${accessDeniedXPath} matched, report Blocked.`);
              return await context.reportBlocked('403', `The selector accessDeniedXPath was found: ${accessDeniedXPath}`);
            }))
          .then(async () => {
            // case where noResultsXPath is there but loadedSelector is not there
            console.log(`The noResultsXPath: ${noResultsXPath} matched, no data returned.`);
            return await context.halt(!returnDataWhenHalt);
          });
      });
  },
};
