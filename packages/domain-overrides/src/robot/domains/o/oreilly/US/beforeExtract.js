module.exports = {
  implements: 'robots/san-antonio/beforeExtract',
  parameterValues: {
    country: 'US',
    domain: 'oreilly',
    schemaYAML: 'multiPages',
  },
  implementation: async (inputs, parameters, context) => {
    if (inputs.schemaYAML === 'prePagination') {
      await context.evaluate(() => {
        const appendUrl = (url, attribute) => {
          const div = document.createElement('div');
          const text = document.createTextNode(url);
          div.appendChild(text);
          div.setAttribute('id', attribute);
          div.setAttribute('href', url);
          document.body.appendChild(div);
        };
        const lastPageEl = document.querySelector('a.btn-link.btn--md:not([aria-label]):not(.is-selected)');
        // @ts-ignore
        const lastPageNumber = Number(lastPageEl?.href?.match(/page=(\d+)/)?.[1] ?? 1);
        if (Number.isNaN(lastPageNumber)) { return; }
        Array.from(Array(lastPageNumber).keys()).forEach((page) => {
          const url = `${document.location.href}?page=${page + 1}`;
          appendUrl(url, 'import_url');
        });
      });
    }
  },
};
