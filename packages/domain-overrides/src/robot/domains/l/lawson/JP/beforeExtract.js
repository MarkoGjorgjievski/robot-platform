module.exports = {
  implements: 'robots/san-antonio/beforeExtract',
  parameterValues: {
    domain: 'lawson',
    country: 'JP',
    schemaYAML: 'singlePage',
  },
  // implementatition: async (inputs, parameters, context) => {
  // const json = await context.evaluate(() => {
  //   const jsonText = document.querySelector(css)
  //     or
  //   document.evaluate(xpath, document, null, ...)
  //   return JSON.parse(jsonText)
  // })
  // const array = json?.array;
  // await Promise.all(array.map(async (arrValue) => {
  //   await context.evaluate((eventNoteRemarkHTML) => {
  //      const htmlString = `<div id="${id}"></div>`;
  //      document.body.insertAdjacentHTML('beforeend', htmlString);
  //      document.querySelector(`#${id}`).innerHTML = eventNoteRemarkHTML;
  //      document.querySelector(`#${id}`).textContent = document.querySelector(`#${id}`).innerText;
  // }, arrValue.fieldName)
  // }))
  // },

  implementation: async (inputs, parameters, context) => {
    const jsonText = await context.evaluate(() => {
      const jsonScript = document.querySelector('script#form-data');
      return jsonScript ? jsonScript.textContent : null;
    });
    if (!jsonText) return;
    const json = JSON.parse(jsonText);
    const array = json?.evCmntList?.map(comment => comment?.detailRmrks?.trim()) ?? [];
    await context.evaluate(() => {
      const htmlString = '<div id="detailRmrks"></div>';
      document.body.insertAdjacentHTML('beforeend', htmlString);
    });
    await Promise.all(array.map(async (detailRmrksHTML) => {
      await context.evaluate((html) => {
        const detailRmrksDiv = document.querySelector('div#detailRmrks');
        detailRmrksDiv.innerHTML += html.trim();
      }, detailRmrksHTML);
    }));
  },
};
