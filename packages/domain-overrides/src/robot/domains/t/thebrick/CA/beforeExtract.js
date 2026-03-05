module.exports = {
  implements: 'robots/san-antonio/beforeExtract',
  parameterValues: {
    country: 'CA',
    domain: 'thebrick',
    schemaYAML: 'multiPages',
  },
  // implementation: async (inputs, parameters, context) => {
  //   const markRecordsToAvoidDuplicates = async () => {
  //     const duplicatesMarkingParameters = {
  //       RECORD_XPATH:
  //         '//div[contains(@class, "Grid")]//ul/li[contains(@class, "Item")]',
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
  //           null,
  //         );

  //         const items = [];
  //         let item = iterator.iterateNext();
  //         while (item) {
  //           items.push(item);
  //           item = iterator.iterateNext();
  //         }

  //         return items;
  //       };
  //       const markRecordsAsReadyToBeCollected = () => {
  //         getElementsByXPath(params.RECORD_XPATH).forEach((record) => {
  //           if (
  //             // @ts-ignore
  //             record.getAttribute(params.STATE_ATTRIBUTE_NAME)
  //             === params.STATES.UNDEFINED
  //           ) {
  //             // @ts-ignore
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
  //             // @ts-ignore
  //             record.getAttribute(params.STATE_ATTRIBUTE_NAME)
  //             === params.STATES.TO_BE_COLLECTED
  //           ) {
  //             // @ts-ignore
  //             record.setAttribute(
  //               params.STATE_ATTRIBUTE_NAME,
  //               params.STATES.ALREADY_COLLECTED,
  //             );
  //           }
  //         });
  //       };

  //       markRecordsAsAlreadyCollected();
  //       markRecordsAsReadyToBeCollected();
  //     }, duplicatesMarkingParameters);
  //   };

  //   if (inputs.schemaYAML === 'multiPages') {
  //     markRecordsToAvoidDuplicates();
  //   }
  // },
};
