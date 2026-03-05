/* eslint-disable max-len */
/* eslint-disable no-return-await */
/**
 *
 * @param { { date: string, results: number} } inputs
 * @param { Record<string, any> } parameters
 * @param { ImportIO.IContext } context
 * @param { Record<string, any> } dependencies
 */

const { preCompileFunctions: { getRobotTemplateName, getAllYAMLFilePaths, getCLIParams, getFolderPath } } = require('../../navigation/navigationHelperLibrary');

module.exports = {
  parameters: [
    {
      name: 'country',
      description: '2 letter ISO code for the country',
    },
    {
      name: 'store',
      description: 'store name',
    },
    {
      name: 'transform',
      description: 'transform function for the extraction',
      optional: true,
    },
  ],
  // @ts-ignore
  get path() {
    const actionjsPath = getRobotTemplateName();
    const folderPath = this.tempPath || `${actionjsPath}/domains/\${domain[0:1]}/\${domain}/\${country}`;

    const template2Path = (template, paramStringName) => template.replace(/\${(.*?)}/g, (match, key) => {
      const slicedKey = key.replace(/\[/g, '?.slice(').replace(/\]/g, ')').replace(/:/g, ',');
      // eslint-disable-next-line no-eval
      return eval(`${paramStringName}?.${slicedKey}`);
    });

    const cliParams = getCLIParams();
    const inferredFolderPath = getFolderPath();
    if (this.parameterValues) {
      const activeFolderPath = template2Path(folderPath, 'this.parameterValues');
      getAllYAMLFilePaths(activeFolderPath).forEach((name) => {
        this.dependencies[name] = `extraction:${activeFolderPath}/${name}`;
      });
    } else if (Object.keys(cliParams).length > 0) {
      const activeFolderPath = template2Path(folderPath, 'cliParams');
      this.dependencies[cliParams.schemaYAML] = `extraction:${activeFolderPath}/${cliParams.schemaYAML}`;
    } else if (inferredFolderPath) {
      getAllYAMLFilePaths(inferredFolderPath).forEach((name) => {
        this.dependencies[name] = `extraction:${inferredFolderPath.slice(1)}/${name}`;
      });
    }
    return `${folderPath.slice(1)}/extract`;
  },
  // @ts-ignore
  set path(val) {
    this.tempPath = val;
  },
  dependencies: {
    append: 'action:helpers/append',
    beforeExtract: 'action:robots/san-antonio/beforeExtract',
    dataHelper: 'module:helpers/data',
    helpers: 'module:helpers/helpers',
  },
  implementation: async (inputs, { transform: transformImplementation }, context, dependencies) => {
    const { append, beforeExtract, dataHelper: { DataModifier }, helpers: { Helpers, YAML } } = dependencies;
    const {
      arrayOfShadowRootCSS, addAttributeToExtractedRecords, paginate, checkXpathBeforeExtract, checkXpathBeforeExtractTimeout, checkXpathBeforeExtractErrMessageSelector, loadingTimeout, allowScreenCaptures, deleteDuplicateDOMElements, checkXpathBeforeExtractHaltConditionXpath,
    } = inputs;
    const helpers = new Helpers(context);
    await append(inputs);
    await beforeExtract(inputs);
    const transform = `(oData, context) => {
      const transform = ${transformImplementation};
      function ${DataModifier.removeFields};
      function ${DataModifier.addFileFields}
      const preTransformedData = addFileFields(removeFields(oData));
      return transform ? transform(preTransformedData, context) : preTransformedData;
    }`;

    const yamlKey = inputs.schemaYAML || 'singlePage';
    if (!dependencies[yamlKey]) throw new Error(`Issue with the specified schemaYAML: ${yamlKey}`);
    if (arrayOfShadowRootCSS) await Promise.all(arrayOfShadowRootCSS.map(async (css, index) => await helpers.moveShadowToMainDom(css, index)));

    if (checkXpathBeforeExtract) {
      await context.waitForXPath(checkXpathBeforeExtract, { timeout: checkXpathBeforeExtractTimeout || loadingTimeout })
        .catch(async () => {
          const errM = await helpers.checkAndReturnProp(checkXpathBeforeExtractErrMessageSelector, 'CSS', 'textContent');
          const defaultM = `ERROR: checkXpathBeforeExtract was not found at time of extraction ${checkXpathBeforeExtract}`;
          const haltCondition = await helpers.checkSelector(checkXpathBeforeExtractHaltConditionXpath, 'XPATH');
          if (haltCondition) {
            return await context.halt(true);
          }
          throw new Error(errM || defaultM);
        });
    }

    if (allowScreenCaptures) await helpers.appendScreenCaptures(inputs, YAML, yamlKey);

    // console.log(resultData);
    // @ts-ignore
    //  console.log(bypassExtract);
    // console.log(typeof extractorContext);
    // @ts-ignore
    // if ((bypassExtract === true || bypassExtract === 'true') && typeof extractorContext !== 'undefined') {
    //   console.log('bypassing extract');
    //   await context.halt(false);
    // }
    const extractedData = await context.extract(dependencies[yamlKey], { transform, type: inputs.mergeType });
    if (addAttributeToExtractedRecords || paginate?.infiniteScroll?.maxScrolls) await helpers.addAttributeToExtractedRecords(addAttributeToExtractedRecords, YAML);

    DataModifier.addExtraFieldsToAllRows(extractedData, inputs);

    // function to delete element node with id __input to prevent engine crash.
    if (deleteDuplicateDOMElements && Array.isArray(deleteDuplicateDOMElements)) await helpers.deleteDuplicateDOMElements(deleteDuplicateDOMElements);

    return extractedData;
  },
};
