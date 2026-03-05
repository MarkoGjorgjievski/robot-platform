module.exports = {
  implements: 'robots/san-antonio/beforeExtract',
  parameterValues: {
    country: 'US',
    domain: 'trustpilot',
    schemaYAML: 'pages',
  },
  implementation: async (inputs, parameters, context) => {
    if (inputs.schemaYAML === 'pages') {
      await context.evaluate(() => {
        const appendUrl = (url, attribute) => {
          const div = document.createElement('div');
          const text = document.createTextNode(url);
          div.appendChild(text);
          div.setAttribute('class', attribute);
          div.setAttribute('href', url);
          document.body.appendChild(div);
        };

        const lastPage = document.querySelector('a[name*="pagination-button"]:nth-last-child(2)');
        const lastPageNumber = lastPage ? parseInt(lastPage.textContent, 10) : 0;
        Array.from({ length: lastPageNumber }, (_, i) => i + 1).forEach((page) => {
          const url = `${window.location.href}?page=${page}`;
          appendUrl(url, 'page_url');
        });
      });
    }
  },
};
