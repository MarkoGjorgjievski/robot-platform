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

export interface FieldValue {
  text: string;
  xpath?: string;
  willBeRemovedInTransform?: boolean;
  linkToDownload?: string;
  type?: string;
  [key: string]: unknown;
}

export type DataRow = Record<string, FieldValue[]>;

export interface DataGroup {
  group: DataRow[];
  [key: string]: unknown;
}

interface NestedPagination {
  nextDepthURLFieldName: string;
  markToRemove?: boolean | string;
}

interface ExtractFieldOptions {
  arrayToConcatWith?: { key: string }[];
  prependDomain?: string;
  removeField?: boolean;
}

interface ExtractionEntry {
  key: string;
  value: Record<string, FieldValue[] | FieldValue>;
}

interface AddExtraFieldsInputs {
  arrayOfInputFieldNamesToAdd?: (string | Record<string, string>)[];
  injectable?: Record<string, unknown>;
  originalInputs: Record<string, unknown>;
}

export class DataModifier {
  static nbCollected(data: DataGroup[]): number {
    return data.reduce((acc, { group }) => acc + (group.length || 0), 0);
  }

  static nbCollectedUnique(data: DataGroup[], fieldName: string): number {
    const arr = this.extractFieldasArray(data, { nextDepthURLFieldName: fieldName, markToRemove: false });
    return arr.length;
  }

  static filterConditions(fieldValue: FieldValue | FieldValue[], needXpath: boolean = false): boolean {
    if (Array.isArray(fieldValue)) return fieldValue.some(el => this.filterConditions(el, needXpath));
    return !!(fieldValue && (fieldValue.xpath || !needXpath) && fieldValue.text && fieldValue.text !== 'null');
  }

  static extractFieldasArray(data: DataGroup[], nestedPagination: NestedPagination | string, { arrayToConcatWith = [], prependDomain = '', removeField = false }: ExtractFieldOptions = {}): ExtractionEntry[] {
    const { nextDepthURLFieldName: fieldName, markToRemove = true } = (typeof nestedPagination === 'string' ? { nextDepthURLFieldName: nestedPagination } : nestedPagination) || {};
    if (!fieldName) return [];
    // @ts-ignore
    const extraction: ExtractionEntry[] = [...new Set([
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

  static markToRemove(data: DataGroup[], fieldName: string, markToRemove: boolean | string): void {
    for (let index = 0; index < data.length; index += 1) {
      const group = data[index].group.map((row) => {
        if ([true].includes(markToRemove as boolean) || (this.filterConditions(row[fieldName], true) && ['ONLY_IF_FOUND'].includes(markToRemove as string))) {
          return Object.entries(row)
            .reduce((acc: DataRow, [fieldHeader, values]) => ({
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

  static removeFields(data: DataGroup[], fieldName?: string): DataGroup[] {
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

  static addFileFields(data: DataGroup[]): DataGroup[] {
    const suffix = '_genFile';
    const cond = (obj: FieldValue) => obj.linkToDownload || obj.type?.toLowerCase() === 'file';
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

  static getReducedData(data: DataGroup[], key: string, fieldName: string): Record<string, FieldValue[] | FieldValue> {
    return data
      .flatMap(({ group }) => group
        ?.reduce((acc: Record<string, FieldValue[]>, row) => {
          // only look at the rows where the key matches, merge them
          if (!row[fieldName]?.find(({ text }) => text === key)) return acc;
          return {
            ...acc,
            ...Object.entries(row).reduce((rAcc: Record<string, FieldValue[]>, [fName, fValues]) => ({
              ...rAcc,
              [fName]: [...(rAcc[fName] || []), ...fValues.map(({ text, xpath, ...rest }) => ({ text, ...rest } as FieldValue))],
            }), {}),
          };
        }, {}))
      .reduce((acc: Record<string, FieldValue[] | FieldValue>, row) => ({
        ...acc,
        ...Object.entries(row).reduce((rAcc: Record<string, FieldValue[] | FieldValue>, [fName, values]) => ({
          ...rAcc,
          // @ts-ignore
          [fName]: [...new Set([...(Array.isArray(rAcc[fName]) ? rAcc[fName] : rAcc[fName] ? [rAcc[fName]] : []), ...(Array.isArray(values) ? values : [values])].map(JSON.stringify))].map(JSON.parse)
          // extra code to turn singletons into single values
            .reduce((rrAcc: FieldValue[] | FieldValue, valR: FieldValue, _: number, array: FieldValue[]) => (array.length > 1 ? [...(Array.isArray(rrAcc) ? rrAcc : [rrAcc]), valR] : valR), [] as FieldValue[] | FieldValue),
        }), {}),
      }), {});
  }

  static addExtraFieldsToAllRows(data: DataGroup[], inputs: AddExtraFieldsInputs): void {
    const fieldsFilter = (inputs.arrayOfInputFieldNamesToAdd || [])
      .reduce((acc: Record<string, string>, el) => ({ ...acc, ...(typeof el === 'string' ? { [el]: el } : el) }), {});
    const extraDataObject: Record<string, unknown> = {
      ...inputs.injectable,
      ...(Object.keys(fieldsFilter).length === 0 ? {} : Object.entries(inputs.originalInputs)
        .filter(([key]) => Object.keys(fieldsFilter).includes(key))
        .reduce((acc: Record<string, unknown>, [key, val]) => ({ ...acc, [fieldsFilter[key]]: val }), {})),
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
    const extra: Record<string, FieldValue[]> = Object.entries(extraDataObject)
      .reduce((acc: Record<string, FieldValue[]>, [key, values]) => ({
        ...acc,
        [key]: (Array.isArray(values) ? values.map((val: FieldValue | string) => ((val as FieldValue).hasOwnProperty?.('text') ? val : { text: val })) : [(values as FieldValue).hasOwnProperty?.('text') ? values : { text: values }])
          .map((el: FieldValue) => ({ ...el, text: typeof el.text === 'string' ? el.text : `${el.text}` })),
      }), {});
    for (let index = 0; index < data.length; index += 1) {
      // eslint-disable-next-line no-param-reassign
      data[index].group = data[index].group.map(row => Object.entries(row).reduce((acc: DataRow, [fieldName, values]) => ({
        ...acc,
        [fieldName]: [...(acc[fieldName] || []), ...values],
      }), extra as DataRow));
    }
  }

  static getAllMarkedFields(data: DataGroup[]): string[] {
    return data.flatMap(({ group }) => group?.flatMap(row => Object.entries(row)
      .filter(([, values]) => values[0].willBeRemovedInTransform).map(([key]) => key)));
  }

  static getAllFields(data: DataGroup[]): Record<string, ExtractionEntry[]> {
    const allFieldNames = data.flatMap(({ group }) => group?.flatMap(row => Object.keys(row)));
    return allFieldNames.reduce((acc: Record<string, ExtractionEntry[]>, field) => ({ ...acc, [field]: this.extractFieldasArray(data, field) }), {});
  }
}
