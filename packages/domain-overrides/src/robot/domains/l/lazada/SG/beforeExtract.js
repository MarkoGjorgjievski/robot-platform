module.exports = {
  implements: 'robots/san-antonio/beforeExtract',
  parameterValues: {
    domain: 'lazada',
    country: 'SG',
    schemaYAML: 'singlePage',
  },
  // dependencies: { actionsProcessor: 'action:helpers/processActions' },
  // implementation: async (
  //   inputs,
  //   parameters,
  //   context,
  //   dependencies,
  // ) => {
  //   const { actionsProcessor: processActions } = dependencies;

  //   console.log('Capturing pageloading request to get the style to click on');
  //   console.log('inputs: ', inputs);
  //   const currentPageUrl = await context.evaluate(() => window.location.pathname);
  //   console.log(`Current page URL: ${currentPageUrl}`);
  //   const responses = await context.searchAllRequests(currentPageUrl, 'GET');
  //   console.log('Requests captured');
  //   if (responses) {
  //     console.log(`number of captured requests: ${responses.length}`);
  //     responses.filter(el => el.responseBody?.body).forEach((res) => {
  //       console.log(`The request body length is ${res.responseBody.body.length}`);
  //       const regExpBase = 'class="sku-.+-selected"\\stitle="([^"]+)"';
  //       const buttonMatches = res.responseBody.body.match(new RegExp(regExpBase, 'g')) ?? [];
  //       console.log(`Found ${buttonMatches.length} buttons to click on`);
  //       buttonMatches.forEach(async (match) => {
  //         const buttonToClick = match.match(new RegExp(regExpBase))[1];
  //         await processActions({
  //           inputs,
  //           actions: [
  //             {
  //               selectorOrXpath: `//span[@title="${buttonToClick}"][not(contains(@class, "selected"))]`,
  //               wait: 1000,
  //             },
  //           ],
  //         }, parameters, context, dependencies);
  //         console.log(`Action performed on a button: ${buttonToClick}`);
  //       });
  //     });
  //     console.log('Clicking done');
  //   } else {
  //     console.log('No requests found');
  //   }
  // },
};
