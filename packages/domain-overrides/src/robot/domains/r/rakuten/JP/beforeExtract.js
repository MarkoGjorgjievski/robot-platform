module.exports = {
  implements: 'robots/san-antonio/beforeExtract',
  parameterValues: {
    country: 'JP',
    domain: 'rakuten',
    schemaYAML: 'multiPages',
  },
  implementation: async (inputs, parameters, context) => {
    await context.evaluate(() => {
      // @ts-ignore
      const dateArray = [...document.querySelectorAll('.dtreviewed')];
      const today = new Date();
      const oneMonthAgo = new Date(today);
      oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);
      const stopElement = dateArray.find((dateElement) => {
        if (!dateElement || !dateElement.textContent) {
          return false;
        }
        const dateStr = dateElement.textContent.trim();
        const date = new Date(dateStr);
        // eslint-disable-next-line no-restricted-globals
        if (isNaN(date.getTime())) {
          return false;
        }
        return date < oneMonthAgo;
      });
      if (stopElement) {
        console.log(stopElement);
        console.log('STOP');
        document.body.setAttribute('stop', 'true');
      } else {
        document.body.setAttribute('stop', 'false');
      }
    });
  },
};
