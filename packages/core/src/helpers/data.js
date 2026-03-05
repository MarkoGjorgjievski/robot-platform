// this is a module containing some ready made functions to help manipulate the extracted data
// to use it do the following in your file.js
/*
//at the bottom of the file, add the following in the module.exports object:
dependencies: {
    dataHelper: 'module:helpers/data',
  },

//inside the implementation function
  const { dataHelper: { DataModifier } } = dependencies;

  // you can now use any of the function like that
  DataModifier.function()

*/

module.exports.DataModifier = class {
  static nbCollected(data) {
    return data.reduce((acc, { group }) => acc + (group.length || 0), 0);
  }

  static nbCollectedUnique(data, fieldName) {
    const arr = this.extractFieldasArray(data, { nextDepthURLFieldName: fieldName, markToRemove: false });
    return arr.length;
  }

  static filterConditions(fieldValue, needXpath = false) {
    if (Array.isArray(fieldValue)) return fieldValue.some(el => this.filterConditions(el, needXpath));
    return fieldValue && (fieldValue.xpath || !needXpath) && fieldValue.text && fieldValue.text !== 'null';
  }

  static extractFieldasArray(data, nestedPagination, { arrayToConcatWith = [], prependDomain = '', removeField = false } = {}) {
    const { nextDepthURLFieldName: fieldName, markToRemove = true } = nestedPagination || {};
    if (!fieldName) return [];
    // @ts-ignore
    const extraction = [...new Set([
      ...arrayToConcatWith.map(obj => obj.key),
      ...data.flatMap(({ group }) => group?.flatMap(row => row[fieldName])
        .filter(el => this.filterConditions(el, false))
        .map(({ text }) => (prependDomain ? `${prependDomain}${text}` : text))),
    ])]
      .map(key => ({ key, value: this.getReducedData(data, key, fieldName) }));
    if (removeField) this.removeFields(data, fieldName);
    if (extraction.length > 0) this.markToRemove(data, fieldName, markToRemove);
    return extraction;
  }

  static markToRemove(data, fieldName, markToRemove) {
    for (let index = 0; index < data.length; index += 1) {
      const group = data[index].group.map((row) => {
        if ([true].includes(markToRemove) || (this.filterConditions(row[fieldName], true) && ['ONLY_IF_FOUND'].includes(markToRemove))) {
          return Object.entries(row)
            .reduce((acc, [fieldHeader, values]) => ({
              ...acc,
              [fieldHeader]: values.map(value => ({ ...value, willBeRemovedInTransform: true })),
            }), {});
        }
        return row;
      });
      // eslint-disable-next-line no-param-reassign
      data[index] = { ...data[index], group };
    }
  }

  static removeFields(data, fieldName) {
    for (let index = 0; index < data.length; index += 1) {
      const group = data[index].group.map((row) => {
        if (fieldName) {
          const { [fieldName]: removed, ...newRow } = row;
          return newRow;
        }
        return Object.fromEntries(Object.entries(row).filter(([, values]) => !values[0].willBeRemovedInTransform));
      }).filter(row => row != null && Object.keys(row).length !== 0);
      // eslint-disable-next-line no-param-reassign
      data[index] = { ...data[index], group };
    }
    return data.filter(({ group }) => group.length !== 0);
  }

  static addFileFields(data) {
    const suffix = '_genFile';
    const cond = obj => obj.linkToDownload || obj.type?.toLowerCase() === 'file';
    for (let index = 0; index < data.length; index += 1) {
      const group = data[index].group.map((row) => {
        const downloadedData = Object.fromEntries(Object.entries(row)
          .filter(([header, values]) => values.some(cond) && !header.endsWith(suffix))
          .map(([header, values]) => [`${header}${suffix}`, values.filter(cond)]));
        return { ...row, ...downloadedData, ...row };
      });
      // eslint-disable-next-line no-param-reassign
      data[index] = { ...data[index], group };
    }
    return data;
  }

  static getReducedData(data, key, fieldName) {
    return data
      .flatMap(({ group }) => group
        ?.reduce((acc, row) => {
          // only look at the rows where the key matches, merge them
          if (!row[fieldName]?.find(({ text }) => text === key)) return acc;
          return {
            ...acc,
            ...Object.entries(row).reduce((rAcc, [fName, fValues]) => ({
              ...rAcc,
              [fName]: [...(rAcc[fName] || []), ...fValues.map(({ text, xpath, ...rest }) => ({ text, ...rest }))],
            }), {}),
          };
        }, {}))
      .reduce((acc, row) => ({
        ...acc,
        ...Object.entries(row).reduce((rAcc, [fName, values]) => ({
          ...rAcc,
          // @ts-ignore
          [fName]: [...new Set([...(rAcc[fName] || []), ...values].map(JSON.stringify))].map(JSON.parse)
          // extra code to turn singletons into single values
            .reduce((rrAcc, valR, _, array) => (array.length > 1 ? [...rrAcc, valR] : valR), []),
        }), {}),
      }), {});
  }

  static addExtraFieldsToAllRows(data, inputs) {
    const fieldsFilter = (inputs.arrayOfInputFieldNamesToAdd || [])
      .reduce((acc, el) => ({ ...acc, ...(typeof el === 'string' ? { [el]: el } : el) }), {});
    const extraDataObject = {
      ...inputs.injectable,
      ...(Object.keys(fieldsFilter).length === 0 ? {} : Object.entries(inputs.originalInputs)
        .filter(([key]) => Object.keys(fieldsFilter).includes(key))
        .reduce((acc, [key, val]) => ({ ...acc, [fieldsFilter[key]]: val }), {})),
    };
    // const fieldsFilter = inputs.arrayOfInputFieldNamesToAdd || [];
    // const extraDataObject = {
    //   ...inputs.injectable,
    //   ...(fieldsFilter.length === 0 ? {} : Object.entries(inputs.originalInputs)
    //     .filter(([key]) => fieldsFilter.includes(key))
    //     .reduce((acc, [key, val]) => ({ ...acc, [key]: val }), {})),
    // };
    // extraDataObject of the type { fieldname: [value1, value2, ...]} or { fieldname: value } or { fieldname: { text: value } }
    if (Object.keys(extraDataObject).length === 0) return;
    // adjust object
    const extra = Object.entries(extraDataObject)
      .reduce((acc, [key, values]) => ({
        ...acc,
        [key]: (Array.isArray(values) ? values.map(val => (val.hasOwnProperty('text') ? val : { text: val })) : [values.hasOwnProperty('text') ? values : { text: values }])
          .map(el => ({ ...el, text: typeof el.text === 'string' ? el.text : `${el.text}` })),
      }), {});
    for (let index = 0; index < data.length; index += 1) {
      // eslint-disable-next-line no-param-reassign
      data[index].group = data[index].group.map(row => Object.entries(row).reduce((acc, [fieldName, values]) => ({
        ...acc,
        [fieldName]: [...(acc[fieldName] || []), ...values],
      }), extra));
    }
  }

  static getAllMarkedFields(data) {
    return data.flatMap(({ group }) => group?.flatMap(row => Object.entries(row)
      .filter(([, values]) => values[0].willBeRemovedInTransform).map(([key]) => key)));
  }

  static getAllFields(data) {
    const allFieldNames = data.flatMap(({ group }) => group?.flatMap(row => Object.keys(row)));
    return allFieldNames.reduce((acc, field) => ({ ...acc, [field]: this.extractFieldasArray(data, field) }), {});
  }
};
