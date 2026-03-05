module.exports = {
  implements: 'navigation/goto/setZipCode',
  parameterValues: {
    country: 'US',
    domain: 'grocery.walmart.com',
    store: 'walmartOG',
  },
  implementation: async (inputs, parameters, context) => {
    const { timeout = 60000, waitUntil = 'load', checkBlocked = true } = {};
    const mainUrl = 'https://grocery.walmart.com';
    await context.goto(mainUrl, { timeout, waitUntil, checkBlocked });
    const { zipcode } = inputs;
    let locationStreetAddress = '';
    let disabledContinueButton = false;

    async function hasDisabledContinuedButton() {
      return await context.evaluate(async () => document.querySelector('button[data-automation-id="locationFlyout-continueBtn"]').hasAttribute('disabled'));
    }

    async function changeLocation(zip) {
      await context.evaluate(async () => {
        if (document.querySelector('div.ReactModalPortal')) {
          document.querySelector('div.ReactModalPortal').remove();
        }
      });
      await context.waitForSelector('button[label="Change store"]');
      await context.evaluate(async () => {
        const button = document.querySelector('button[label="Change store"]');
        if (button) {
          // @ts-ignore
          button.click();
        }
      });
      await context.waitForSelector('input[data-automation-id="zipSearchField"]');
      await context.setInputValue('input[data-automation-id="zipSearchField"]', zip);
      await context.click('button[data-automation-id="zipSearchBtn"]');

      await context.waitForSelector('li[data-automation-id="selectFlyoutItem"]');
      await context.waitForSelector('li[data-automation-id="selectFlyoutItem"]:first-child input');
      await context.evaluate(async () => {
        const searchZipCode = document.querySelector('input[data-automation-id="selectFlyoutItemBtn"]:first-child');
        if (searchZipCode !== undefined) {
          // @ts-ignore
          searchZipCode.click();
        }
        locationStreetAddress = (document.querySelector('li[data-automation-id="selectFlyoutItem"] span[class^="AddressPanel__addressLine"]')) ? document.querySelector('li[data-automation-id="selectFlyoutItem"] span[class^="AddressPanel__addressLine"]').textContent : '';
      });

      const sel = 'button[data-automation-id="locationFlyout-continueBtn"]';

      await context.waitForSelector(sel);

      disabledContinueButton = await hasDisabledContinuedButton();

      if (disabledContinueButton === false) {
        await context.click(sel);
        await context.waitForSelector('button[data-automation-id="confirmFulfillmentBtn"]');
        await context.click('button[data-automation-id="confirmFulfillmentBtn"]');
        await new Promise(resolve => setTimeout(resolve, 15000));
        await context.waitForSelector('div[data-automation-id="changeStoreFulfillmentBannerBtn"] span[class^="AddressPanel__addressLine"]');
        // context.waitForMutuation('div[data-automation-id="changeStoreFulfillmentBannerBtn"] span[class^="AddressPanel__addressLine"]', { timeout: 20000 });
      }
    }

    const changedLocationStreetAddress = await context.evaluate(() => document.querySelector('div[data-automation-id="changeStoreFulfillmentBannerBtn"] span[class^="AddressPanel__addressLine"]')?.textContent || '');

    // TODO: need to set this as input
    if (!(changedLocationStreetAddress === '4208 Pleasant Crossing Blvd') && disabledContinueButton === false) {
      await changeLocation(zipcode);
      if (locationStreetAddress !== changedLocationStreetAddress) {
        await changeLocation(zipcode);
      }
      if (locationStreetAddress !== changedLocationStreetAddress) {
        console.log(locationStreetAddress);
        console.log(changedLocationStreetAddress);
        throw new Error('Fail to change zipcode');
      }
    }
  },
};
