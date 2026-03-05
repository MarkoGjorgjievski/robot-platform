/**
* @param {{ selector: string }} inputs
* @param { Record<string, any> } parameters
* @param { ImportIO.IContext } context
* @param { Record<string, any> } dependencies
*/

// When provided with a json this will create a table

interface AddDynamicTableInputs {
  enableAutoTable?: boolean;
  makeCSVTable?: string;
}

interface AddDynamicTableDependencies {
  helperModule: { Helpers: new (context: any) => any };
}

interface AddDynamicTableContext {
  evaluate: (fn: Function | string, ...args: any[]) => Promise<any>;
}

export const dependencies = { helperModule: 'module:helpers/helpers' };

export const implementation = async (
  { enableAutoTable = true, makeCSVTable = '' }: AddDynamicTableInputs,
  parameters: Record<string, any>,
  context: AddDynamicTableContext,
  { helperModule: { Helpers } }: AddDynamicTableDependencies,
): Promise<void> => {
  const helper = new Helpers(context);
  // check if there is a need to add a dynamic table
  const selector = makeCSVTable || 'body > pre:only-of-type, #rawdata-panel > .rawdata > .textPanelBox > div.panelContent > pre.data';
  const preData = enableAutoTable || makeCSVTable ? await helper.checkAndReturnProp(selector, 'CSS', 'textContent') : false;
  if (preData) {
    try {
      const tableTag = '<table border="1" cellspacing="0" cellpadding="5" style="widht: 100%; padding: 5px; margin: 5px auto;">';
      const theadTag = '<thead bgcolor="#CCC4F5" style="color: black;">';
      const trTag = '<tr style="padding: 5px;">';

      const generateTableStringFromJSON = (value: any, depth = 0): string => {
        const makeHeader = (rows: string[]) => rows.reduce((acc: string, header: string, ind: number, arr: string[]) => `${acc}<th>${header}</th>${ind === arr.length - 1 ? '</tr></thead>' : ''}`, `${theadTag}${trTag}`);
        const makeRow = (row: [string, any][]) => row.reduce((acc: string, [key, nestedValue]: [string, any], ind: number, arr: [string, any][]) => `${acc}<td class="${key} depth_${depth}">${generateTableStringFromJSON(nestedValue, depth + 1)}</td>${ind === arr.length - 1 ? '</tr>' : ''}`, trTag);
        if (Array.isArray(value)) {
          // check if array of "records"
          const isRecords = value.every((elem: any) => elem && typeof elem === 'object');
          if (isRecords) {
            // @ts-ignore
            const headers: string[] = [...new Set(value.reduce((acc: string[], obj: any) => [...acc, ...Object.keys(obj)], []))];
            const headerString = makeHeader(headers);
            const bodyString = value.reduce((acc: string, obj: any) => {
              const entries: [string, any][] = headers.map((heading: string) => [heading, obj[heading]]);
              return `${acc}${makeRow(entries)}`;
            }, '');
            return `${tableTag}${headerString}<tbody>${bodyString}</tbody></table>`;
          }
          // eslint-disable-next-line sonarjs/no-nested-template-literals
          const bodyString = value.reduce((acc: string, item: any, index: number) => `${acc}${makeRow([[`LISTITEM_${index}`, item]])}`, '');
          return `${tableTag}${makeHeader(['item'])}<tbody>${bodyString}</tbody></table>`;
        }
        if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || !value) {
          return String(value || '');
        }
        if (typeof value === 'object') {
          const headers = makeHeader(Object.keys(value));
          const body = makeRow(Object.entries(value));
          return `${tableTag}${headers}<tbody>${body}</tbody></table>`;
        }
        return 'table code issue';
      };
      const generateTableStringFromCSV = (csv: string): string => {
        const rows = csv.split('\n').map((row: string) => row.split(','));
        if (!rows.length) return '';
        const headers = rows[0].reduce((acc: string, header: string, ind: number, arr: string[]) => `${acc}<th>${header}</th>${ind === arr.length - 1 ? '</tr></thead>' : ''}`, `${theadTag}${trTag}`);
        let html = `${tableTag}${headers}<tbody>`;

        rows.slice(1).forEach((row: string[]) => {
          html += trTag;
          row.forEach((cell: string, i: number) => {
            html += `<td class="${rows?.[0]?.[i]}">${cell}</td>`;
          });
          html += '</tr>';
        });

        html += '</tbody></table>';
        return html;
      };

      const finalString = makeCSVTable ? generateTableStringFromCSV(preData) : generateTableStringFromJSON(JSON.parse(preData));

      await context.evaluate((htmlString: string, sel: string) => {
        document.querySelector(sel)!.innerHTML = '';
        document.body.insertAdjacentHTML('afterbegin', htmlString);
      }, `<div id="added-table" style="overflow: auto;">${finalString}</div>`, selector);
    } catch (error) {
      console.log('Something went wrong while generating a dynamic table', error);
    }
  }
};
