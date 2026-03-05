/**
 *
 * @param { { date: string, results: number} } inputs
 * @param { Record<string, any> } parameters
 * @param { ImportIO.IContext } context
 * @param { Record<string, any> } dependencies
 */

module.exports = {
  implements: 'robots/san-antonio/beforeExtract',
  parameterValues: {
    country: 'FR',
    store: 'mon-liquide',
    domain: 'mon-liquide',
  },
  implementation: async (inputs, parameters, context, dependencies) => {
    const { helperModule: { Helpers } } = dependencies;
    const helper = new Helpers(context);
    const isNodeThere = await helper.checkSelector("//script[contains(@id, 'combinationsFromController_')]", 'XPATH');
    if (!isNodeThere) {
      // @ts-ignore
      const quantity = await context.evaluate(() => window.quantityAvailable_eo);
      await context.saveJson('combinationsFromController_', { value: { quantity, 16: '' } });
    }
  },
};
