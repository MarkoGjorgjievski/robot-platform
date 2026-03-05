/**
 * @param {{ inputs, stringToInterpolate, encode }} inputs
 * @param { Record<string, any> } parameters
 * @param { ImportIO.IContext } context
 * @param { Record<string, any> } dependencies
 */

// When provided with an array of actions (selectorOrXpath, inputValue, wait) will execute them in order

module.exports = {
  dependencies: {
    randomizer: 'module:helpers/randomWords',
    wordList: 'module:helpers/wordList',
    parseURL: 'action:helpers/parseURL',
  },
  implementation: async ({ inputs, stringToInterpolate, encode = false, removeUnused = true }, parameters, context, dependencies) => {
    const { randomizer: { Randomizer }, wordList: { wordList }, parseURL } = dependencies;
    const { url, previousURL, opTags, currentIndex } = inputs;
    if (!stringToInterpolate) return '';
    // Get the base url/domain
    // const extractDomain = str => (str?.includes('//') ? `${str?.split('/')?.[0] || ''}//${str?.split('/')?.[2] || ''}` : '');
    const extractDomain = async str => (await parseURL(str)).domain;
    const parsedURL = await parseURL(url);

    const enc = (el, doEncode = encode) => (doEncode ? encodeURIComponent(el) : el);
    const getVal = (key) => {
      const val = (Array.isArray(inputs[key]) ? inputs[key][currentIndex || 0] : inputs[key]);
      return val?.text || val;
    };

    // handle the replacement for all the keys inside input matching the template
    const inputsReplaced = Object.keys(inputs).reduce((interpolated, key) => {
      if (['host', 'query', 'opTags', 'subTemplate', 'opTags'].includes(key) || !getVal(key)) return interpolated;
      const regex = new RegExp(`{${key}}`, 'g');
      return interpolated.replace(regex, enc(getVal(key), encode ? !(key.toLowerCase().endsWith('url') || key.toLowerCase().startsWith('url')) : encode));
    }, stringToInterpolate.replace(/{subTemplate}/, getVal('subTemplate') || '{subTemplate}'))
      .replace(/{today}/g, new Date().toISOString().split('T')[0])
      .replace(/{todayNB}/g, new Date().toISOString().split('.').shift()
        .replace(/\D/g, ''))
      .replace(/{year}/g, new Date().getFullYear())
      .replace(/{month}/g, new Date().getMonth() + 1)
      .replace(/{day}/g, new Date().getDay())
      .replace(/{queryParams}/g, getVal('query') || parsedURL.search.slice(1) || '') // does not include the '?'
      .replace(/{urlNoQuery}/g, `${parsedURL.origin}${parsedURL.pathname}`)
      .replace(/{randomSlug}/g, enc(Randomizer.generateSlug(wordList)));

    return inputsReplaced
      .replace(/{host}/g, inputsReplaced.startsWith('http') ? '' : inputs.prependDomain || await extractDomain(previousURL) || await extractDomain(url) || await extractDomain(stringToInterpolate))
      .replace(/({(?!optTags)[a-zA-Z]+})/g, removeUnused ? '' : '$1')// remove all unused
      .replace(/{opTags}/g, opTags || ''); // add opttags at the end
  },
};
