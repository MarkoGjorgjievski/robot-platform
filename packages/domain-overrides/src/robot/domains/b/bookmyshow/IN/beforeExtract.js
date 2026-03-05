/* eslint-disable max-len */
module.exports = {
  implements: 'robots/san-antonio/beforeExtract',
  parameterValues: {
    domain: 'bookmyshow',
    country: 'IN',
    schemaYAML: 'singlePage',
  },
  dependencies: { processActions: 'action:helpers/processActions', helperModule: 'module:helpers/helpers' },
  implementation: async (inputs, parameters, context, dependencies) => {
    const { processActions, helperModule: { Helpers } } = dependencies;
    let res;
    const sleep = delay => new Promise(resolve => setTimeout(resolve, delay));
    const requestFunction = async () => {
      await sleep(2000);
      res = await context.searchForRequest('/le/events/info');
      let ec;
      if (res) {
        if (res.responseBody.base64Encoded) {
          ec = JSON.parse(Buffer.from(res.responseBody.body, 'base64').toString('utf-8'));
        } else {
          ec = JSON.parse(res.responseBody.body);
        }
        // const ec = JSON.parse(res.responseBody.body);
        await context.saveJson('eventFullData', ec.data);
        Object.entries(ec.data.eventCards).flatMap(([venueCode, object]) => Object.entries(object).flatMap(([dateValue, object1]) => Object.entries(object1).flatMap(([dateTimeValue, object2]) => Object.entries(object2).flatMap(async ([ticketId, object3]) => (
          await context.saveJson(`eventURLDATA_${ticketId}`, {
            ...object3, venueCode, dateValue, dateTimeValue, ticketId,
          })
        )))));
      }
    };
    if (inputs.schemaYAML === 'singlePage') {
      const backSelector = '(//*[@id="app"]//div[./*[1][name()="svg"]])[2]';
      await context.reload();
      await sleep(5000);
      const helper1 = new Helpers(context);
      const stadiumSelector = await helper1.checkXpathSelector('//div[contains(text(),"How many seats?")]');
      const backSelectorPresent = await helper1.checkXpathSelector(backSelector);
      if (backSelectorPresent) {
        if (!stadiumSelector) {
          await requestFunction();
        }
        await processActions({ inputs, actions: [{ selectorOrXpath: backSelector, wait: 2000 }] });
        if (!res) {
          await requestFunction();
        }
      }
      // Object.entries(ec).flatMap(([venueCode, object]) => Object.entries(object).flatMap(([dateValue, object1]) => Object.entries(object1).flatMap(([dateTimeValue, object2]) => Object.entries(object2).flatMap(([ticketId, object3]) => ({
      //   ...object3, venueCode, dateValue, dateTimeValue, ticketId,
      // })))));
    }
  },
};
