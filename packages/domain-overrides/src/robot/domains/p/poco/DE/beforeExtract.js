module.exports = {
  implements: 'robots/san-antonio/beforeExtract',
  parameterValues: {
    country: 'DE',
    domain: 'poco',
    schemaYAML: 'multiPages',
  },
  // // TODO: refactor, simplify
  // implementation: async (inputs, parameters, context) => {
  //   const markRecordsToAvoidDuplicates = async () => {
  //     const duplicatesMarkingParameters = {
  //       RECORD_SELECTOR: "a[data-purpose='productTile.link.product']",
  //       STATE_ATTRIBUTE_NAME: 'collection-state',
  //       STATES: {
  //         UNDEFINED: null,
  //         TO_BE_COLLECTED: 'TO_BE_COLLECTED',
  //         ALREADY_COLLECTED: 'ALREADY_COLLECTED',
  //       },
  //     };

  //     const markRecordsAsReadyToBeCollected = () => {
  //       context.evaluate((params) => {
  //         document
  //           .querySelectorAll(params.RECORD_SELECTOR)
  //           .forEach((record) => {
  //             if (
  //               record.getAttribute(params.STATE_ATTRIBUTE_NAME)
  //               === params.STATES.UNDEFINED
  //             ) {
  //               record.setAttribute(
  //                 params.STATE_ATTRIBUTE_NAME,
  //                 params.STATES.TO_BE_COLLECTED,
  //               );
  //             }
  //           });
  //       }, duplicatesMarkingParameters);
  //     };

  //     const markRecordsAsAlreadyCollected = () => {
  //       context.evaluate((params) => {
  //         document
  //           .querySelectorAll(params.RECORD_SELECTOR)
  //           .forEach((record) => {
  //             if (
  //               record.getAttribute(params.STATE_ATTRIBUTE_NAME)
  //               === params.STATES.TO_BE_COLLECTED
  //             ) {
  //               record.setAttribute(
  //                 params.STATE_ATTRIBUTE_NAME,
  //                 params.STATES.ALREADY_COLLECTED,
  //               );
  //             }
  //           });
  //       }, duplicatesMarkingParameters);
  //     };

  //     markRecordsAsAlreadyCollected();
  //     markRecordsAsReadyToBeCollected();
  //   };

  //   if (inputs.schemaYAML === 'multiPages') {
  //     markRecordsToAvoidDuplicates();
  //   }
  // },
};
