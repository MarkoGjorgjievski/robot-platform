module.exports = {
  implements: 'robots/san-antonio/beforeExtract',
  parameterValues: {
    country: 'FR',
    domain: 'vuse',
    schemaYAML: 'multiPages',
  },
  implementation: async (inputs, parameters, context) => {
    await context.evaluate(async () => {
      const catElement = document.createElement('div');
      catElement.id = 'id';
      catElement.setAttribute('rating', 'ratingVal');
      catElement.setAttribute('reviewDate', 'date');
      catElement.textContent = 'content';
      catElement.style.display = 'none';
      document.body.appendChild(catElement);
    });

    // eslint-disable-next-line sonarjs/no-duplicate-string
    await context.waitForSelector('#onetrust-banner-sdk').catch(() => { console.log("Cookies didn't appear"); });
    await context.click('#onetrust-accept-btn-handler').catch(() => { console.log("Cookies didn't appear"); });
    await context.click('#btn-entry-age-allow').catch(() => { console.log("Cookies didn't appear"); });

    await context.evaluate(async () => {
      try {
        await new Promise(resolve => setTimeout(resolve, 30000));
        const reviewsArr = [];
        // @ts-ignore
        const productId = document.querySelector('div[data-bv-show="rating_summary"]').dataset.bvProductId;
        console.log('pRoduct Id', productId);
        const mainDiv = document.createElement('div');
        mainDiv.id = 'added-reviews';
        mainDiv.hidden = true;
        document.body.appendChild(mainDiv);
        const getReviews = async (id) => {
          for (let offset = 0; ;) {
            const res = await fetch(`https://api.bazaarvoice.com/data/batch.json?passkey=caIOS8W8C5WFEY6UmO08cTBKw6BOrRpazSuGIIfmRgOMo&apiversion=5.5&displaycode=16562-en_gb&resource.q0=reviews&filter.q0=isratingsonly%3Aeq%3Afalse&filter.q0=productid%3Aeq%3A${id}&filter.q0=contentlocale%3Aeq%3Aen*%2Cen_GB&sort.q0=submissiontime%3Adesc&stats.q0=reviews&filteredstats.q0=reviews&include.q0=authors%2Cproducts%2Ccomments&filter_reviews.q0=contentlocale%3Aeq%3Aen*%2Cen_GB&filter_reviewcomments.q0=contentlocale%3Aeq%3Aen*%2Cen_GB&filter_comments.q0=contentlocale%3Aeq%3Aen*%2Cen_GB&limit.q0=100&offset.q0=${offset}&limit_comments.q0=3`);
            const data = await res.json();
            const totalreviews = data.BatchedResults.q0.TotalResults;
            if (offset > totalreviews) {
              break;
            }
            reviewsArr.push(...data.BatchedResults.q0.Results);
            offset += 100;
          }
        };
        await getReviews(productId);
        // eslint-disable-next-line no-plusplus
        for (let i = 0; i < reviewsArr.length; i++) {
          const reviewsDiv = document.querySelector('#added-reviews');
          const reviewText = reviewsArr[i].ReviewText;
          const reviewDate = reviewsArr[i].SubmissionTime;
          const reviewTitle = reviewsArr[i].Title;
          const reviewRating = reviewsArr[i].Rating;
          const helpfulCount = reviewsArr[i].TotalPositiveFeedbackCount;

          const div = document.createElement('div');
          div.id = 'review';
          div.setAttribute('review-text', reviewText);
          div.setAttribute('review-date', reviewDate);
          div.setAttribute('review-title', reviewTitle);
          div.setAttribute('review-rating', reviewRating);
          div.setAttribute('helpful-count', helpfulCount);
          div.setAttribute('brand-Text', 'VUSE');
          div.setAttribute('country', 'US');

          reviewsDiv.appendChild(div);
        }
      } catch (err) { console.log(err); }
    });
  },
};
