module.exports = {
  implements: 'robots/san-antonio/beforeExtract',
  parameterValues: {
    country: 'US',
    domain: 'bbb',
    schemaYAML: 'multiPages',
  },
  implementation: async (inputs, parameters, context) => {
    await context.evaluate(() => {
      const preElement = document.querySelector('pre');

      const jsonData = JSON.parse(preElement.textContent);

      const container = document.createElement('div');
      container.id = 'reviews-container';

      jsonData.items.forEach((item) => {
        const reviewDiv = document.createElement('div');
        reviewDiv.className = 'review-item';

        const displayNameElement = document.createElement('h3');
        displayNameElement.setAttribute('data-displayName', item.displayName);

        const ratingElement = document.createElement('p');
        ratingElement.setAttribute('data-reviewStarRating', item.reviewStarRating);

        const dateElement = document.createElement('p');
        dateElement.setAttribute('data-date', `${item.date.month}/${item.date.day}/${item.date.year}`);

        const reviewBodyElement = document.createElement('p');
        reviewBodyElement.setAttribute('data-reviewBody', item.text);

        reviewDiv.appendChild(displayNameElement);
        reviewDiv.appendChild(ratingElement);
        reviewDiv.appendChild(dateElement);
        reviewDiv.appendChild(reviewBodyElement);

        container.appendChild(reviewDiv);
      });

      document.body.appendChild(container);
    });
  },
};
