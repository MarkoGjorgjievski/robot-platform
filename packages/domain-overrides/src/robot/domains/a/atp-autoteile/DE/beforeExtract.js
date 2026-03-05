module.exports = {
  implements: 'robots/san-antonio/beforeExtract',
  parameterValues: {
    country: 'DE',
    domain: 'atp-autoteile',
    schemaYAML: 'multiPages',
  },
  implementation: async (inputs, parameters, context, dependencies) => {
    const { helperModule: { Helpers } } = dependencies;
    const helper = new Helpers(context);
    await new Promise(resolve => setTimeout(resolve, 3000));
    if (await helper.checkXpathSelector('//*[contains(text(),"Technische Informationen")]//following-sibling::div')) {
      await context.evaluate(() => {
        function transformLists(selector) {
          document.querySelectorAll(`${selector} ul`).forEach((ul) => {
            const ulText = ul?.firstChild?.nodeValue?.trim() || '';
            if (ulText) {
              const newLi = document.createElement('li');
              newLi.textContent = `${ulText}`;
              ul.prepend(newLi);
            }
            const { previousSibling } = ul;
            if (previousSibling && previousSibling?.nodeType === Node.TEXT_NODE) {
              const text = previousSibling?.textContent?.trim();
              if (text) {
                const firstLi = ul.querySelector('li');
                if (firstLi) {
                  firstLi.textContent = `${text} ${firstLi.textContent}`;
                } else {
                  const newLi = document.createElement('li');
                  newLi.textContent = `${text}`;
                  ul.prepend(newLi);
                }
                previousSibling.remove();
              }
            }
          });
        }
        const techInfo = document.querySelector('.technical-info .description-content');
        const limitations = document.querySelector('.limitations .description-content');

        if (limitations) {
          transformLists('.limitations .description-content');
        }
        if (techInfo?.innerHTML?.includes('<br>')) {
          const items = techInfo.innerHTML
            .split('<br>')
            .map(text => `<li>${text.trim()}</li>`)
            .join('');
          techInfo.innerHTML = `<ul>${items}</ul>`;
        }
        const elemText = techInfo?.firstChild?.nodeValue?.trim() || '';
        if (elemText) {
          const newLi = document.createElement('li');
          newLi.textContent = `${elemText}`;
          techInfo.prepend(newLi);
        }
        if (limitations?.innerHTML?.includes('<br>')) {
          const items = limitations.innerHTML
            .split('<br>')
            .map(text => `<li>${text.trim()}</li>`)
            .join('');
          limitations.innerHTML = `<ul class="bb-list-bull">${items}</ul>`;
        }
        if (document.querySelector('.technical-info .description-content ul')?.firstChild?.nodeValue) {
          transformLists('.technical-info .description-content');
        }
        transformLists('.hint .description-content');
      });
    }
  },
};
