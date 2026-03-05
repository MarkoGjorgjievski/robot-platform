module.exports = {
  implements: 'robots/san-antonio/beforeExtract',
  parameterValues: {
    country: 'JP',
    domain: 'amazon',
    schemaYAML: 'multiPages',
  },
  implementation: async (inputs, parameters, context) => {
    if (inputs.schemaYAML === 'multiPages') {
      await context.evaluate(async () => {
        const parents = document.querySelectorAll('#aod-offer-seller-rating');

        parents.forEach((parent) => {
          const starIcon = parent.querySelector('.a-icon-star-mini');
          const ratingSpan = parent.querySelector('.a-size-small');

          if (starIcon && ratingSpan) {
            const starIconClasses = starIcon.getAttribute('class');
            const ratingClassMatches = starIconClasses.match(/a-star-brand-mini-([\d-]+)/);

            if (ratingClassMatches) {
              const rating = ratingClassMatches[1].replace('-', '.');
              parent.setAttribute('rating', rating);
              console.log(rating);
            }
          }
        });

        const pinnedParent = document.querySelector('#aod-asin-reviews-star');

        if (pinnedParent) {
          const starIconClasses = pinnedParent.getAttribute('class');
          const ratingClassMatches = starIconClasses.match(/a-star-([\d-]+)/);

          if (ratingClassMatches) {
            const rating = ratingClassMatches[1].replace('-', '.');
            pinnedParent.setAttribute('rating', rating);
            console.log(rating);
          }
        }
      });
    }
  },
};

// const res = await context?.searchForRequest('ref=ox')?.then(result => JSON?.parse(result.responseBody.body));
// if (res !== undefined) await context.saveJson('requestData', res);
// await context.evaluate(async () => {
//   document.querySelector('input[name="quantityBox"]')?.setAttribute('value', '100');
// });
// await new Promise(resolve => setTimeout(resolve, 2000)); // Wait for 2 seconds
// await helper.ifThereClickOnIt('a.a-button-text[data-action="update"]');

// const pinnedParent = document.querySelector('#aod-asin-reviews');
// if (pinnedParent) {
//   const aggregateRating = pinnedParent.firstElementChild.firstElementChild.classList.contains('a-icon-star')
// && pinnedParent.firstElementChild.getAttribute('class')?.split(' ').find(t => t.includes('a-star-'))
//     ?.split('-')
//     .filter(n => +n)
//     .join('.');
//   if (aggregateRating) pinnedParent.setAttribute('rating', aggregateRating);
// }
