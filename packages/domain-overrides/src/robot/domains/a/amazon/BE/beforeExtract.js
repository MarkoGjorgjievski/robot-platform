module.exports = {
  implements: 'robots/san-antonio/beforeExtract',
  parameterValues: {
    country: 'BE',
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
            const ratingClassMatches = starIconClasses.match(/a-star-mini-([\d-]+)/);

            if (ratingClassMatches) {
              const rating = ratingClassMatches[1].replace('-', ',');
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
            const rating = ratingClassMatches[1].replace('-', ',');
            pinnedParent.setAttribute('rating', rating);
            console.log(rating);
          }
        }
      });
    }
  },
};
