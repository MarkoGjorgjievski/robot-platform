module.exports = {
  implements: 'robots/san-antonio/beforeExtract',
  parameterValues: {
    country: 'DE',
    domain: 'blu',
    schemaYAML: 'multiPages',
  },
  implementation: async (inputs, parameters, context) => {
    await context.evaluate(() => {
      const ratingBoxes = document.querySelectorAll('article div.css-1ctyjoz > div:nth-child(6)');
      console.log(ratingBoxes);
      ratingBoxes.forEach((box, index) => {
        try {
          const boxWidth = getComputedStyle(box).width;
          console.log(boxWidth);

          const widthElement = document.createElement('div');
          widthElement.id = `width-pct-${index + 1}`;
          widthElement.textContent = `${parseFloat(boxWidth) / 24}`;
          box.parentNode.insertBefore(widthElement, box.nextSibling);
        } catch (error) {
          console.log('Element not found: ', error);
        }
      });
    });
  },
};
