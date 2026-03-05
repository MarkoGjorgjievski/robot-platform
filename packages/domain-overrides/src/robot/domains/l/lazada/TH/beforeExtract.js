module.exports = {
  implements: 'robots/san-antonio/beforeExtract',
  parameterValues: {
    domain: 'lazada',
    country: 'TH',
    schemaYAML: 'multiPages',
  },
  // dependencies: { actionsProcessor: 'action:helpers/processActions' },
  // implementation: async (
  //   inputs,
  //   parameters,
  //   context,
  //   dependencies,
  // ) => {
  //   // const firstSize = document.querySelector('.sku-variable-name-text');
  //   // if (!firstSize) return;
  //   // if (firstSize.hasAttribute('clickedOnce')) return;
  //   // firstSize.addEventListener('click', () => {
  //   //   firstSize.setAttribute('clickedOnce', 'true');
  //   // })
  //   const { helperModule: { Helpers } } = dependencies;
  //   await context.evaluate(() => {
  //     const helper = new Helpers(context);
  //     const firstSize = document.querySelector('.sku-variable-name-text');
  //     if (firstSize && !firstSize.hasAttribute('clickedOnce')) {
  //       helper.IfThereClickOnIt(firstSize)
  //       firstSize.setAttribute('clickedOnce', 'true');
  //     }
  //   })
  // },
};
