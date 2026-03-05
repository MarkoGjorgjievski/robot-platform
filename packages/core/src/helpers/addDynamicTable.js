/**
* @param {{ selector: string }} inputs
* @param { Record<string, any> } parameters
* @param { ImportIO.IContext } context
* @param { Record<string, any> } dependencies
*/

// When provided with a json this will create a table
module.exports = {
  dependencies: { helperModule: 'module:helpers/helpers' },
  implementation: async ({ enableAutoTable = true, makeCSVTable = '' }, parameters, context, { helperModule: { Helpers } }) => {
    const helper = new Helpers(context);
    // check if there is a need to add a dynamic table
    const selector = makeCSVTable || 'body > pre:only-of-type, #rawdata-panel > .rawdata > .textPanelBox > div.panelContent > pre.data';
    const preData = enableAutoTable || makeCSVTable ? await helper.checkAndReturnProp(selector, 'CSS', 'textContent') : false;
    if (preData) {
      try {
        const tableTag = '<table border="1" cellspacing="0" cellpadding="5" style="widht: 100%; padding: 5px; margin: 5px auto;">';
        const theadTag = '<thead bgcolor="#CCC4F5" style="color: black;">';
        const trTag = '<tr style="padding: 5px;">';

        const generateTableStringFromJSON = (value, depth = 0) => {
          const makeHeader = rows => rows.reduce((acc, header, ind, arr) => `${acc}<th>${header}</th>${ind === arr.length - 1 ? '</tr></thead>' : ''}`, `${theadTag}${trTag}`);
          const makeRow = row => row.reduce((acc, [key, nestedValue], ind, arr) => `${acc}<td class="${key} depth_${depth}">${generateTableStringFromJSON(nestedValue, depth + 1)}</td>${ind === arr.length - 1 ? '</tr>' : ''}`, trTag);
          if (Array.isArray(value)) {
            // check if array of "records"
            const isRecords = value.every(elem => elem && typeof elem === 'object');
            if (isRecords) {
              // @ts-ignore
              const headers = [...new Set(value.reduce((acc, obj) => [...acc, ...Object.keys(obj)], []))];
              const headerString = makeHeader(headers);
              const bodyString = value.reduce((acc, obj) => {
                const entries = headers.map(heading => [heading, obj[heading]]);
                return `${acc}${makeRow(entries)}`;
              }, '');
              return `${tableTag}${headerString}<tbody>${bodyString}</tbody></table>`;
            }
            // eslint-disable-next-line sonarjs/no-nested-template-literals
            const bodyString = value.reduce((acc, item, index) => `${acc}${makeRow([[`LISTITEM_${index}`, item]])}`, '');
            return `${tableTag}${makeHeader(['item'])}<tbody>${bodyString}</tbody></table>`;
          }
          if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || !value) {
            return value || '';
          }
          if (typeof value === 'object') {
            const headers = makeHeader(Object.keys(value));
            const body = makeRow(Object.entries(value));
            return `${tableTag}${headers}<tbody>${body}</tbody></table>`;
          }
          return 'table code issue';
        };
        const generateTableStringFromCSV = (csv) => {
          const rows = csv.split('\n').map(row => row.split(','));
          if (!rows.length) return '';
          const headers = rows[0].reduce((acc, header, ind, arr) => `${acc}<th>${header}</th>${ind === arr.length - 1 ? '</tr></thead>' : ''}`, `${theadTag}${trTag}`);
          let html = `${tableTag}${headers}<tbody>`;

          rows.slice(1).forEach((row) => {
            html += trTag;
            row.forEach((cell, i) => {
              html += `<td class="${rows?.[0]?.[i]}">${cell}</td>`;
            });
            html += '</tr>';
          });

          html += '</tbody></table>';
          return html;
        };

        const finalString = makeCSVTable ? generateTableStringFromCSV(preData) : generateTableStringFromJSON(JSON.parse(preData));

        await context.evaluate((htmlString, sel) => {
          document.querySelector(sel).innerHTML = '';
          document.body.insertAdjacentHTML('afterbegin', htmlString);
        }, `<div id="added-table" style="overflow: auto;">${finalString}</div>`, selector);
      } catch (error) {
        console.log('Something went wrong while generating a dynamic table', error);
      }
    }
  },
};
