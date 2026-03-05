/**
 *
 * @param { { id: any } } inputs
 * @param { { domain: string, prefix?: string, suffix?: string, url?: string } } parameters
 * @param { ImportIO.IContext } context
 * @param { { } } dependencies
 */

module.exports = {
  dependencies: { interpolate: 'action:helpers/inputInterpolation' },
  implementation: async (inputs, parameters, context, dependencies) => {
    const { id, keywords, passThroughUrl, URLTemplate } = inputs;
    const { interpolate } = dependencies;

    if (passThroughUrl) return passThroughUrl;
    if (URLTemplate) {
      if (URLTemplate.includes('{searchTerms}') && !keywords) throw new Error('No keywords provided, while they are expected in the template');
      if (URLTemplate.includes('{id}') && !id) throw new Error('No id provided, while it is expected in the template');

      return interpolate({ inputs, stringToInterpolate: URLTemplate, encode: true });
    }
    throw new Error('No url was provided to the extractor and URLtemplate was specified to create a valid URL');
  },
};
