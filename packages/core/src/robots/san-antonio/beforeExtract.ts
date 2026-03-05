/**
 *
 * @param { { date: string, results: number} } inputs
 * @param { Record<string, any> } parameters
 * @param { ImportIO.IContext } context
 * @param { Record<string, any> } dependencies
 */

module.exports = {
  parameters: [
  ],
  dependencies: { helperModule: 'module:helpers/helpers', processActions: 'action:helpers/processActions', goto2: 'action:navigation/goto2' },
  path: './domains/${domain[0:1]}/${domain}/${country}/beforeExtract',
  implementation: async () => {},
};
//
