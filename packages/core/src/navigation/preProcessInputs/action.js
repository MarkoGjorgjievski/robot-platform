/* eslint-disable no-restricted-syntax */
/* code executed before anything to preprocess inputs
the function expects the parameter `preProcessInputs` to be set like these examples or any combination of them:

preProcessInputs:
  inputName1:
     regexSubstituteBeforeAll:
       regExp: ';'
       regExpReplace: '&'
       # flags --- default to 'g'
     regexSubstituteAfterAll:
       regExp: ';'
       regExpReplace: '&'
       # flags --- default to 'g'
    removeAllQueryAttributes: true
  inputName2:
    removeSpecificQueryAttributes:
      - page
      - sessionID

or

preProcessInputs:
  inputName1:
    onlyKeepSpecificQueryAttributes:
      - categoryID
  inputName3:
    removeSpecificQueryAttributes:
      - page
    onlyKeepSpecificQueryAttributes:
      - whatever

or as an array

preProcessInputs:
  - inputToProcess: inputName1
    onlyKeepSpecificQueryAttributes:
      - categoryID
  - inputToProcess: inputName3
    removeSpecificQueryAttributes:
      - page
    onlyKeepSpecificQueryAttributes:
      - whatever
*/

// supported actions are - in order of prevalence:
// regexSubstituteBeforeAll --- substitutes one instance - or multiple depending on the flag - of a character with another
// rename --- renames an input
// getAndRename --- Allows to get a json, key, or array value and then rename it { rename: name, get: dot.path }
// removeAllQueryAttributes --- deletes all the query attributes
// removeSpecificQueryAttributes --- only deletes the specified query attributes
// onlyKeepSpecificQueryAttributes --- deletes all the other attributes but the one specified
// addQueryAttributes -- add key value pair to the parameters { attributeName: attributeValue }, the value is automatically encoded
// regexSubstituteAfterAll

module.exports = {
  dependencies: {
    parseURL: 'action:helpers/parseURL',
    interpolate: 'action:helpers/inputInterpolation',
  },
  implementation: async (inputs, parameters, context, { parseURL, interpolate }) => {
    const { preProcessInputs: preProcessInputsRaw, querySearchDelimiter, depth = 0 } = inputs;

    const preProcessInputs = Array.isArray(preProcessInputsRaw || {})
      ? preProcessInputsRaw
        .reduce((acc, { inputToProcess, ...rest }) => ({ ...acc, [inputToProcess]: rest }), {})
      : preProcessInputsRaw || {};

    const inputsToProcess = Object.keys(preProcessInputs || {});
    const newInputs = { ...inputs }; // shallow copy

    const updatedInput = (inputKey, cb, variable) => {
      const oldValue = variable || newInputs[inputKey];
      if (typeof oldValue === 'object' && oldValue.text) {
        return cb(oldValue.text);
      }
      if (Array.isArray(oldValue)) {
        return oldValue.map(elem => updatedInput(inputKey, cb, elem));
      }
      return cb(oldValue);
    };

    const substitute = (subObj, inputKey) => {
      if (Array.isArray(subObj)) {
        subObj.forEach(subArrObj => substitute(subArrObj, inputKey));
      } else if (newInputs[inputKey] && Object.keys(subObj || {}).length) {
        const { regExp, flags = 'g', regExpBuilt = new RegExp(regExp, flags), regExpReplace } = subObj;
        newInputs[inputKey] = updatedInput(inputKey, el => el?.replace(regExpBuilt, regExpReplace));
      }
    };

    for (let index = 0; index < inputsToProcess.length; index += 1) {
      const input = inputsToProcess[index]; // the object keys are the inputs to manipulate
      const {
        rename,
        getAndRename = [],
        regexSubstituteBeforeAll = {},
        regexSubstituteAfterAll = {},
        removeAllQueryAttributes = false,
        removeSpecificQueryAttributes = [],
        onlyKeepSpecificQueryAttributes = [],
        addQueryAttributes = {},
      } = preProcessInputs[input];

      substitute(regexSubstituteBeforeAll, input);

      if (querySearchDelimiter) {
        newInputs[input] = updatedInput(input, async (el) => {
          const { origin, search, pathname, hash } = await parseURL(el);
          const newSearch = search.replace(new RegExp(querySearchDelimiter, 'g'), '&');
          return `${origin}${pathname}${newSearch}${hash}`;
        });
      }

      if (rename) {
        newInputs[rename] = newInputs[input];
      }

      if (getAndRename && Array.isArray(getAndRename) && getAndRename.length) {
        getAndRename.forEach(({ rename: newName, get = '' }) => {
          const pathArr = get.replace(/^\./, '').replace(/\[(\d)\]/g, '.$1').split('.').filter(el => el); // change path [nb] to .nb no support for path ."datalayer[4]"
          const valueAtPath = pathArr.reduce((acc, pth) => acc?.[pth], newInputs?.[input]);
          newInputs[newName] = valueAtPath;
        });
      }

      if (removeAllQueryAttributes) {
        // if removeAllQueryAttributes only process that one
        const { origin, hash, pathname } = await parseURL(newInputs[input]);
        newInputs[input] = `${origin}${pathname}${hash}`;
      } else if ((removeSpecificQueryAttributes && Array.isArray(removeSpecificQueryAttributes) && removeSpecificQueryAttributes.length)
      || (onlyKeepSpecificQueryAttributes && Array.isArray(onlyKeepSpecificQueryAttributes) && onlyKeepSpecificQueryAttributes.length)) {
        // if either are set, process them both but start with the keep and then remove
        const {
          origin, hash, pathname, searchParams, parsedURL,
        } = await parseURL(newInputs[input]);
        const addToRemove = [];

        if ((onlyKeepSpecificQueryAttributes || []).length) {
          for (const key of searchParams.keys()) {
            if (!onlyKeepSpecificQueryAttributes.includes(key)) addToRemove.push(key);
          }
        }

        (removeSpecificQueryAttributes || []).concat(addToRemove).forEach((attribute) => {
          searchParams.delete(attribute);
          newInputs[input] = `${origin}${pathname}${parsedURL.search}${hash}`;
        });
      }

      if (addQueryAttributes && Object.keys(addQueryAttributes).length) {
        const {
          origin, hash, pathname, searchParams, parsedURL,
        } = await parseURL(newInputs[input]);

        Object.entries(addQueryAttributes).forEach(([key, value]) => {
          searchParams.set(key, value);
          newInputs[input] = `${origin}${pathname}${parsedURL.search}${hash}`;
        });
      }

      if (querySearchDelimiter) {
        const { origin, search, pathname, hash } = await parseURL(newInputs[input]);
        const newSearch = search.replace(/&/g, querySearchDelimiter);
        newInputs[input] = `${origin}${pathname}${newSearch}${hash}`;
      }

      substitute(regexSubstituteAfterAll, input);
    }

    if (JSON.stringify(newInputs) !== JSON.stringify(inputs)) {
      console.log(`Pre processing of the inputs was applied per ${JSON.stringify(preProcessInputsRaw)}`);
    }

    // interpolate on all the elements
    const recursiveInterpolation = async (obj, interpolDepth, key) => {
      if (!obj) return obj;
      const elem = key != null ? obj[key] : obj;
      if (key === 'nestedPagination' && interpolDepth >= depth) return elem;
      if (['URLTemplate', 'originalInputs', 'injectable', 'newGoto2', 'inputs', 'subTemplate'].includes(key)) return elem;
      let newVal;
      if (elem == null) {
        // do nothing
      } else if (Array.isArray(elem)) {
        newVal = [];
        for (let index = 0; index < elem.length; index += 1) {
          newVal[index] = await recursiveInterpolation(elem, interpolDepth, index);
        }
      } else if (typeof elem === 'object') {
        const arr = Object.keys(elem);
        const newDepth = key === 'nestedPagination' ? interpolDepth + 1 : interpolDepth;
        newVal = {};
        for (let index = 0; index < arr.length; index += 1) {
          const subKey = arr[index];
          newVal[subKey] = await recursiveInterpolation(elem, newDepth, subKey);
        }
      } else if (typeof elem === 'string') {
        let interpolatedStr = await interpolate({ inputs: newInputs, stringToInterpolate: `${elem}`, removeUnused: false });
        if (interpolatedStr === 'false') interpolatedStr = false;
        if (interpolatedStr === 'null') interpolatedStr = null;
        newVal = interpolatedStr;
      } else {
        newVal = elem;
      }
      return newVal;
    };
    return recursiveInterpolation(newInputs, 0);
  },
};
