/* eslint-disable prefer-destructuring */
/* eslint-disable no-param-reassign
*/
/**
 *
 * @param {ImportIO.Group[]} data
 * @returns {ImportIO.Group[]}
 */

const cleanUp = (data) => {
  const mapping = {
    offer_price: (text, row) => {
      if (!row.original_price?.[0]?.text) {
        row.original_price = [{ text: `${text}` }];
        text = '';
      }
      return text;
    },
    description_properties: (text, row) => {
      text = text.replace(/:\n/g, '');
      text = text.replace(/\n \n/g, '!');
      const materials = text.match(/(?<=Materiál: )(.*?)(?=!)/g)?.[0];
      if (materials !== undefined) row.materials = [{ text: `${materials}` }];
      return text;
    },
    product_properties: (text, row) => {
      text = text.replace(/\n\s/g, '!');
      const weight = text.match(/(?<=Hmotnosť \(kg\) !!)(.*?)(?= !)/g)?.[0];
      const colour = text.match(/(?<=Farba - detailná !!)(.*?)((?= !))/g)?.[0];
      const materials = text.match(/(?<=Materiál !!)(.*?)(?= !)/g)?.[0];
      const length = text.match(/(?<=Hĺbka \(cm\) !!)(.*?)(?= !)/g)?.[0];
      const width = text.match(/(?<=Šírka \(cm\) !!)(.*?)(?= !)/g)?.[0];
      const height = text.match(/(?<=Výška \(cm\) !!)(.*?)(?= !)/g)?.[0];
      if (colour !== undefined) row.colour = [{ text: `${colour}` }];
      if (weight !== undefined) row.weight_raw = [{ text: `${weight}` }];
      if (materials !== undefined) row.materials = [{ text: `${materials}` }];
      if (height !== undefined) row.height = [{ text: `${height}` }];
      if (width !== undefined) row.width = [{ text: `${width}` }];
      if (length !== undefined) row.length = [{ text: `${length}` }];
      return text;
    },
    product_details_raw: (text, row) => {
      text = text.replace(/:\n/g, '');
      text = text.split('\n \n');
      row.product_details = text.map(el => ({ text: el }));
      return text;
    },
  };

  const mappingFct = (header, arr, row) => arr.map(({ text, ...other }) => ({ text: mapping[header](text, row), ...other }));

  data.forEach(obj => obj.group.forEach(row => Object.keys(row).forEach((header) => {
    // eslint-disable-next-line no-param-reassign
    if (mapping[header]) row[header] = mappingFct(header, row[header], row);
  })));

  return data;
};

module.exports = { cleanUp };
