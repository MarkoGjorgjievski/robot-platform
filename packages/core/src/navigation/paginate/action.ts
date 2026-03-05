/**
 *
 * @param {{
*  paginate: object,
*  offset: number,
*  page: number,
*  useGoto2: boolean,
* }} inputs
* @param { ImportIO.IContext } context
* @param { Record<string, any> } dependencies
*/

module.exports = {
  dependencies: {
    helperModule: 'module:helpers/helpers',
    xpathElemToCSS: 'action:helpers/xpathToCSS',
    goto: 'action:navigation/goto',
    goto2: 'action:navigation/goto2',
    validatePage: 'action:navigation/validatePage',
    createUrl: 'action:navigation/createURL',
  },
  implementation: async (inputs, parameters, context, dependencies) => {
    const { paginate = {}, offset, page, useGoto2 } = inputs;
    const {
      stopConditionSelectorOrXpath, nextLink: {
        // @ts-ignore
        nextLinkSelectorOrXpath, spinnerSelectorOrXpath, mutationSelectorOrXpath, waitForXpath, nextLinkTimeout = 5000,

      } = {}, openSearchDefinition, infiniteScroll,
    } = paginate;
    const { helperModule: { Helpers }, xpathElemToCSS, validatePage, createUrl } = dependencies;

    const helper = new Helpers(context);

    if (stopConditionSelectorOrXpath) {
      const stopConditionCSS = await xpathElemToCSS({ selectorToCheck: stopConditionSelectorOrXpath });
      if (!stopConditionCSS) throw new Error(`Failed to generate a valid CSS selector from ${stopConditionSelectorOrXpath}, try to directly provide a CSS selector instead, ${inputs.depthString}`);
      if ((await helper.checkSelector(stopConditionCSS))) {
        console.log('<><><><> The stop condition selector was found <><><><>');
        return false;
      }
    }

    const isOpenSearch = openSearchDefinition && openSearchDefinition.template;
    const isInfiniteScroll = infiniteScroll && infiniteScroll.maxScrolls;
    // eslint-disable-next-line no-nested-ternary
    const paginationConfig = isOpenSearch ? 'openSearchDefinition' : (isInfiniteScroll ? 'infiniteScroll' : 'nextLink');

    console.log(`<><><><> Pagination is configured with ${paginationConfig}`);
    if (isOpenSearch) {
      const {
        pageStartNb = 1, indexOffset = 0, pageOffset = 0, pageIndexMultiplier = 0, template,
      } = openSearchDefinition;
      const pageNb = page + pageStartNb - 1;
      const builtUrl = await createUrl({
        ...inputs,
        URLTemplate: template,
        page: pageNb + pageOffset,
        index: pageNb * pageIndexMultiplier,
        offset: offset + indexOffset,
      });
      await dependencies[useGoto2 ? 'goto2' : 'goto']({ ...inputs, url: builtUrl });
    } else if (isInfiniteScroll) {
      const {
        maxScrolls, stopXPath, waitTime, scrollFunction = 'scrollToBottom', scrollToElementSelectorOrXpath, infiniteScrollTimeout, scrollFromSelectorOrXpath, doNotScrollXpath, wait, steps,
      } = infiniteScroll;

      if (scrollFunction === 'scrollToBottom') {
        await Promise.race([
          ...(infiniteScrollTimeout ? [await new Promise(resolve => setTimeout(resolve, infiniteScrollTimeout))] : []),
          await context.scrollToBottom({ maxScrolls, stopXPath, waitTime }),
        ]);
      }
      if (scrollFunction === 'scrollIntoView' && scrollToElementSelectorOrXpath) {
        await helper.scrollToElementUntil(
          await xpathElemToCSS({ selectorToCheck: scrollToElementSelectorOrXpath }),
          stopXPath,
          { timeout: infiniteScrollTimeout, waitTime },
        );
      }
      if (scrollFunction === 'scrollBy') {
        await helper.scrollBy(scrollToElementSelectorOrXpath, maxScrolls);
      }
      if (scrollFunction === 'scrollToTarget') {
        const selector = await xpathElemToCSS({ selectorToCheck: scrollToElementSelectorOrXpath });
        const scrollFrom = await xpathElemToCSS({ selectorToCheck: scrollFromSelectorOrXpath });
        await helper.scrollTarget(scrollFrom, selector, stopXPath, doNotScrollXpath, { waitTime: wait, steps });
      }
    } else {
      if (!nextLinkSelectorOrXpath) throw new Error(`Pagination was rexpected but no nextLinkSelectorOrXpath or openSearchDefinition were defined in the parameters. ${inputs.depthString || ''}`);

      const [nextLinkCSS, spinnerCSS, mutationCSS] = await Promise.all(
        [nextLinkSelectorOrXpath, spinnerSelectorOrXpath, mutationSelectorOrXpath]
          .map(sel => xpathElemToCSS({ selectorToCheck: sel })),
      );

      if (!nextLinkCSS) throw new Error(`Failed to generate a valid CSS selector from ${nextLinkSelectorOrXpath}, try to directly provide a CSS selector instead, ${inputs.depthString}`);

      if (!(await helper.checkSelector(nextLinkCSS))) {
        console.log('The next page selector does not allow to navigate to a new page');
        return false;
      }

      console.log('Clicking on the nextLink');
      await helper.ifThereClickOnIt(nextLinkCSS);

      try {
        if (await helper.checkSelector(spinnerCSS)) await helper.waitToDisappear(spinnerCSS, nextLinkTimeout);
        if (mutationCSS) await context.waitForMutation(mutationCSS, { timeout: nextLinkTimeout });
        if (waitForXpath) await helper.optionalWait(waitForXpath, { timeout: nextLinkTimeout }, 'XPATH');
      } catch (error) {
        throw new Error(`ERROR: The pagination failed with error: ${error}`);
      }

      // wait a little for the nextlinkCSS to appear again
      await helper.optionalWait(nextLinkCSS, nextLinkTimeout);
    }

    await validatePage(inputs);

    console.log(`Successfully paginated to page ${page}`);
    return true;
  },
};
