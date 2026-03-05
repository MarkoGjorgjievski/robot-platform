module.exports = {
  implements: 'robots/san-antonio/beforeExtract',
  parameterValues: {
    country: 'GB',
    domain: 'diy',
    schemaYAML: 'multiPages',
  },
  // implementation: async (inputs, parameters, context) => {
  //   const markRecordsToAvoidDuplicates = async () => {
  //     const params = {
  //       RECORD_XPATH:
  //         '//a[@data-test-id="product-panel-main-section"]',
  //       STATE_ATTRIBUTE_NAME: 'collection-state',
  //       STATES: {
  //         UNDEFINED: null,
  //         TO_BE_COLLECTED: 'TO_BE_COLLECTED',
  //         ALREADY_COLLECTED: 'ALREADY_COLLECTED',
  //       },
  //     };

  //     context.evaluate((params) => {
  //       const getElementsByXPath = (path) => {
  //         const iterator = document.evaluate(
  //           path,
  //           document,
  //           null,
  //           XPathResult.UNORDERED_NODE_ITERATOR_TYPE,
  //           null
  //         );

  //         const items = [];
  //         let item;
  //         while ((item = iterator.iterateNext())) {
  //           items.push(item);
  //         }

  //         return items;
  //       };
  //       const markRecordsAsReadyToBeCollected = () => {
  //         getElementsByXPath(params.RECORD_XPATH).forEach((record) => {
  //           if (
  //             record.getAttribute(params.STATE_ATTRIBUTE_NAME)
  //             === params.STATES.UNDEFINED
  //           ) {
  //             record.setAttribute(
  //               params.STATE_ATTRIBUTE_NAME,
  //               params.STATES.TO_BE_COLLECTED,
  //             );
  //           }
  //         });
  //       };
  //       const markRecordsAsAlreadyCollected = () => {
  //         getElementsByXPath(params.RECORD_XPATH).forEach((record) => {
  //           if (
  //             record.getAttribute(params.STATE_ATTRIBUTE_NAME)
  //             === params.STATES.TO_BE_COLLECTED
  //           ) {
  //             record.setAttribute(
  //               params.STATE_ATTRIBUTE_NAME,
  //               params.STATES.ALREADY_COLLECTED,
  //             );
  //           }
  //         });
  //       };

  //       markRecordsAsAlreadyCollected();
  //       markRecordsAsReadyToBeCollected();
  //     }, params);
  //   };

  //   markRecordsToAvoidDuplicates();
  // },
};
