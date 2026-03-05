async function implementation(
  inputs,
  parameters,
  context,
) {
  const { url, zipcode } = inputs;
  console.log(`Zip${zipcode}`);

  const doesPriceExists = async function (xpath) {
    return await context.evaluate((xp) => {
      const element = document.evaluate(xp, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
      console.log(`Element${element}`);
      return element ? element.textContent : null;
    }, xpath);
  };

  const priceSelector = url.includes('searchTerm') ? '//span[contains(@class,"finalPrice")] | //div[contains(@aria-label,"Actual Price")] | //div[contains(@class,"pl-price js-pl-price")]//span' : '//span[@class="aPrice large"]';
  const applyScrollToPage = !url.includes('searchTerm');
  const price = await doesPriceExists(priceSelector);
  if (price) {
    console.log('price is available, do not load store page');
    if (applyScrollToPage) {
      await context.scrollToBottom();
    }
    return;
  }

  const NEAREST_STORE_URL = zipcode === '1360' ? 'https://www.lowes.com/store/MA-Hadley/1916' : 'https://www.lowes.com/store/CA-Burbank/1144';
  await context.goto(NEAREST_STORE_URL, { timeout: 50000, waitUntil: 'load', checkBlocked: true });

  const shopButtonEle = await context.evaluate(() => !!document.evaluate('//button[contains(.,\'SHOP THIS STORE\')]/button', document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue);

  if (shopButtonEle) {
    await context.click('header > button');
    await context.waitForNavigation({ timeout: 50000, waitUntil: 'load' });
  }
  console.log('params', parameters);
  await context.goto(url, { timeout: 50000, waitUntil: 'load', checkBlocked: true });
  if (applyScrollToPage) {
    await context.scrollToBottom();
  }
}

module.exports = {
  implements: 'navigation/goto/setZipCode',
  parameterValues: {
    country: 'US',
    domain: 'lowes.com',
    store: 'lowes',
  },
  implementation,
};
