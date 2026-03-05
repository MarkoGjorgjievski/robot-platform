/* eslint-disable no-param-reassign
*/
/**
 *
 * @param {ImportIO.Group[]} data
 * @returns {ImportIO.Group[]}
 */

const cleanUp = (data) => {
  const mapping = {
    product_details_tmp: (text, row) => {
      if (!row.product_details) {
        row.product_details = [];
      }

      row.product_details.push({ text: `${text.replace('\n', ': ')}` });

      return text;
    },
    materials_tmp: (text, row) => {
      if (!row.materials) {
        row.materials = [];
      }

      row.materials = JSON.parse(text).map(t => ({ text: `${t}` }));
    },
    offer_price: (text, row) => {
      if (!row.original_price?.[0]?.text) {
        row.original_price = [{ text: `${text}` }];
        text = '';
      }
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
//   json_data: (text, row) => {
//     const jsonData = JSON.parse(text);

//     console.log("JSON DATA")

//     if(!jsonData || !jsonData.page) {
//         console.log("NO JSON DATA!");
//         return;
//     }

//     console.log("GENERAL")

//     row.test = [{ text: `${jsonData.props.pageProps.locale}` }]
//   }
