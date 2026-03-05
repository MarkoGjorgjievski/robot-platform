/* eslint-disable no-return-await */
/**
* @param {{ loadedSelector: string, noResultsXPath: string }} inputs
* @param { Record<string, any> } parameters
* @param { ImportIO.IContext } context
* @param { Record<string, any> } dependencies
*/

module.exports = {
  dependencies: {
    helperModule: 'module:helpers/helpers', makeTable: 'action:helpers/addDynamicTable', processActions: 'action:helpers/processActions', setZip: 'action:navigation/setZipCode', pageCorrectlyLoaded: 'action:navigation/pageCorrectlyLoaded',
  },
  implementation: async (inputs, parameters, context, dependencies) => {
    const {
      loadedSelector, loadedXpath, waitForSelectorToLoad, waitForXPathToLoad, orderedSelectorsToClickOn = [], orderedActionsToPerform = [],
      loadingTimeout = 5000, maxScrolls = 3, reloadXpath,
    } = inputs;
    if (!loadedSelector && !loadedXpath) throw new Error('Currently no loadedSelector has been set. You need to set a CSS selector matching a valid page load containing the desired data');

    const {
      helperModule: { Helpers }, makeTable, processActions, setZip, pageCorrectlyLoaded,
    } = dependencies;
    const helper = new Helpers(context);

    await helper.addURLtoDocument(inputs);

    await makeTable(inputs);

    await pageCorrectlyLoaded(inputs);

    if (reloadXpath && !(await helper.checkSelector(reloadXpath, 'XPATH'))) {
      await context.reload();
      await helper.optionalWait(reloadXpath, loadingTimeout, 'XPATH');
      if (!(await helper.checkSelector(reloadXpath, 'XPATH'))) await context.reportBlocked();
    }

    if (maxScrolls) await context.scrollToBottom({ maxScrolls: parseInt(maxScrolls, 10) });
    await helper.optionalWait(waitForSelectorToLoad, loadingTimeout, 'CSS');
    await helper.optionalWait(waitForXPathToLoad, loadingTimeout, 'XPATH');

    await setZip(inputs);
    await processActions({ inputs, actions: orderedSelectorsToClickOn.concat(orderedActionsToPerform) });
  },
};
