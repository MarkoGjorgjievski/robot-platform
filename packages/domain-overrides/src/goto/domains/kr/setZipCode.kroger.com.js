async function implementation(inputs, parameters, context) {
  const { zipcode } = inputs;

  const getCurrentZip = async () => await context.evaluate(async () => {
    const element = document.querySelector('span[data-testid="CurrentModality-vanityName"]');
    if (element) {
      return element.textContent;
    }
    return null;
  });

  const findButtonWithStoreSelect = async () => {
    await context.evaluate(() => {
      const mystore = document.querySelector('button[aria-label*="Select Store"]');
      // @ts-ignore
      if (mystore) mystore.click();
    });
  };

  const findClosestStore = async () => {
    const indexToClick = await context.evaluate(async () => {
      const sections = document.querySelectorAll('div.ModalitySelector--StoreSearchResult');
      let smallestDistance = null;
      let indexToClosestStore = null;
      sections.forEach((sectionItem, i) => {
        const section = sectionItem.querySelector('div.StoreSearchResults-StoreButtonWrapper div div');

        if (section && section.textContent) {
          const distance = parseFloat(section.textContent);
          if (!smallestDistance || distance < smallestDistance) {
            smallestDistance = distance;
            indexToClosestStore = i + 1;
          }
        }
        console.log(section.textContent);
      });
      console.log(`Closest store: ${smallestDistance}`);
      return indexToClosestStore;
    });
    await context.click(`div.ModalitySelector--StoreSearchResult:nth-of-type(${indexToClick}) div.StoreSearchResults-StartButton`);
  };

  const changeZip = async (wantedZip) => {
    await context.click('button.CurrentModality-button');
    await new Promise(resolve => setTimeout(resolve, 6000));

    await context.setInputValue('input[data-testid="PostalCodeSearchBox-input"]', wantedZip);
    await new Promise(resolve => setTimeout(resolve, 6000));

    await context.click('button.kds-SolitarySearch-button');
    await new Promise(resolve => setTimeout(resolve, 6000));
    await findButtonWithStoreSelect();
    await new Promise(resolve => setTimeout(resolve, 8000));
    await findClosestStore();
    await new Promise(resolve => setTimeout(resolve, 6000));
  };

  const currentZip = await getCurrentZip();
  console.log(`Want zip: ${zipcode}, got zip: ${currentZip}`);

  if (currentZip !== zipcode) {
    console.log('Trying to change zip');
    await changeZip(zipcode);
  }

  await context.evaluate(() => {
    const overlay = document.querySelector('.ReactModal__Overlay ReactModal__Overlay--after-open ModalitySelectorDynamicTooltip--Overlay page-popovers');

    if (overlay) {
      // @ts-ignore
      overlay.click();
    }
  });
  await new Promise(resolve => setTimeout(resolve, 2000));
}

module.exports = {
  implements: 'navigation/goto/setZipCode',
  parameterValues: {
    country: 'US',
    domain: 'kroger.com',
    store: 'kroger',
  },
  implementation,
};
