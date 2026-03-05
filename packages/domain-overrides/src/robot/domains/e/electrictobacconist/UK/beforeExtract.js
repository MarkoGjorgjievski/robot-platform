module.exports = {
  implements: 'robots/san-antonio/beforeExtract',
  parameterValues: {
    country: 'UK',
    domain: 'electrictobacconist',
    schemaYAML: 'multiPages',
  },
  implementation: async (inputs, parameters, context) => {
    await context.evaluate(async () => {
      function addHiddenDiv(id, content, ratingVal, date) {
        const catElement = document.createElement('div');
        catElement.id = id;
        catElement.setAttribute('rating', ratingVal);
        catElement.setAttribute('reviewDate', date);
        catElement.textContent = content;
        catElement.style.display = 'none';
        document.body.appendChild(catElement);
      }
      const reviewClick = document.querySelector('span[data-tab="reviews"]');
      // @ts-ignore
      reviewClick?.click();
      let reviewCount = '100';
      const reviewCounNode = document.querySelector('div.header__group div.R-TextBody');
      if (reviewCounNode) {
        // eslint-disable-next-line prefer-destructuring
        reviewCount = reviewCounNode.textContent.match(/\d+/g)[0];
        console.log('ReviewCount: ', reviewCount);
      }
      const currUrl = window.location.href;
      const splitUrls = currUrl.split('-');
      const sku = splitUrls[splitUrls.length - 1];
      try {
        const reviewApi = `https://api.reviews.co.uk/timeline/data?type=product_review&store=electrictobacconistcouk&sort=date_desc&page=1&per_page=${reviewCount}&sku=${sku}&lang=en&enable_avatars=true&include_subrating_breakdown=1`;
        console.log(reviewApi);
        const reviewRes = await fetch(reviewApi, {
          headers: {
            accept: 'application/json, text/plain, */*',
            'accept-language': 'en-US,en;q=0.9',
            'sec-fetch-dest': 'empty',
            'sec-fetch-mode': 'cors',
            'sec-fetch-site': 'cross-site',
            'sec-gpc': '1',
          },
          referrer: 'https://www.electrictobacconist.co.uk/',
          referrerPolicy: 'strict-origin-when-cross-origin',
          body: null,
          method: 'GET',
          mode: 'cors',
          credentials: 'omit',
        });
        if (reviewRes) {
          const scriptContent = await reviewRes.json();
          const reviews = scriptContent.timeline;
          if (reviews) {
            reviews.forEach((review) => {
              // eslint-disable-next-line no-underscore-dangle
              addHiddenDiv('script-review', review._source.comments, review._source.rating, review._source.date_created);
            });
          }
        } else {
          throw new Error('Script missing, reviews under new location');
        }
      } catch (exception) {
        throw new Error(`Something went wront in parsing/appending reviews: ${exception}`);
      }
    });
  },
};
