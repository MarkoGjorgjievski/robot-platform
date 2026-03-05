module.exports = {
  implements: 'robots/san-antonio/beforeExtract',
  parameterValues: {
    country: 'US',
    domain: 'mouser',
    schemaYAML: 'multiPages',
  },
  implementation: async (inputs, parameters, context) => {
    if (inputs.schemaYAML === 'multiPages') {
      await context.evaluate(() => {
        const appendUrl = (url, attribute) => {
          const div = document.createElement('div');
          const text = document.createTextNode(url);
          div.appendChild(text);
          div.setAttribute('id', attribute);
          div.setAttribute('href', url);
          document.body.appendChild(div);
        };
        function chunkArray(array, chunkSize) {
          const chunks = [];
          for (let i = 0; i < array.length; i += chunkSize) {
            chunks.push(array.slice(i, i + chunkSize));
          }
          return chunks;
        }
        const prodPage = !!document.querySelector('#pdpMainContentDiv');
        const cat = document.querySelector('td.attr-grp[id*="Series"]');
        // @ts-ignore
        const canonicalUrl = document.querySelector('link[rel="canonical"]').href;
        // if statement to ensure we are only performing this in the first level of pagination (the '?' indicates filtering in the second level)
        if (!prodPage) {
          const opt = document.querySelector('[id*="Series"] option');
          if (opt) {
            // @ts-ignore
            opt.click();
          }
          // @ts-ignore
          const catName = cat.querySelector('input[id*="GroupName"]').value;
          const catOpts = Array.from(cat.querySelectorAll('select[id*="Series"] option'));

          if (catName.includes('Series')) {
            const chunks = chunkArray(catOpts, 2);
            chunks.forEach((chunk) => {
              const inductanceValues = `${encodeURIComponent(chunk[0].text)
              }~~${
                encodeURIComponent(chunk[chunk.length - 1].text)}`;

              const append = canonicalUrl.includes('?') ? '&' : '?';
              const url = `${canonicalUrl}${append}${encodeURIComponent(catName)}=${inductanceValues}&core%20material=Alloy%20Powder~~Carbonyl%20Powder%7C~Composite%7C~Iron~~Iron%20Powder%7C~Metal~~Molded&rp=passive-components%2Finductors-chokes-coils%2Fpower-inductors-smd%7C~Core%20Material%7C~Series`;
              appendUrl(url, 'import_cat_filter_url');
            });
          }
          if (canonicalUrl.includes('?')) {
            const productsPerPage = 25;
            const count = document.querySelector('#lblreccount')?.textContent;
            const pages = count ? Math.min(50, Math.ceil(parseInt(count?.replace(/,/g, ''), 10) / productsPerPage)) : 0;
            Array.from(Array(pages).keys()).forEach((page) => {
              const pg = page + 1;
              const url = `${canonicalUrl}&pg=${pg}`;
              appendUrl(url, 'import_url');
            });
          }
        } else {
          // @ts-ignore
          const link = document.querySelector('link[rel="canonical"]').href;
          appendUrl(link, 'pdp_url');
        }
      });
    } else {
      await context.evaluate(() => {
        const spanElements = document.querySelectorAll('[class*="searchResultColumn"] > span');
        spanElements.forEach((span) => {
          if (span.textContent.trim() === 'Datasheet') {
            span.classList.add('heading-title');
          }
        });
        const headers = document.querySelectorAll('[class="tblHeader"] [class*="heading-t"]');
        const headerMap = Array.from(headers).reduce((map, header, index) => {
          const headerText = header.textContent.trim().replace(/\n+|\s+/g, '').replace(/\(\w+\).*$/g, '');
          if (headerText) {
            // eslint-disable-next-line no-param-reassign
            map[index + 1] = headerText;
          }
          return map;
        }, {});
        const rows = document.querySelectorAll('#SearchResultsGrid_grid tbody tr[class*=" "]');
        rows.forEach((row) => {
          const cells = row.querySelectorAll('td[class*="column"]');
          cells.forEach((cell, index) => {
            const headerText = headerMap[index + 1];
            if (headerText) {
              cell.setAttribute('column', headerText);
            }
          });
        });
      });
    }
  },
};
