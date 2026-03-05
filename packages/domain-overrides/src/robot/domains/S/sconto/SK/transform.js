/**
 *
 * @param {ImportIO.Group[]} data
 * @returns {ImportIO.Group[]}
 */

const cleanUp = (data) => {
  const takeUnit = (text) => {
    const arr = text.split(' ');
    return arr[arr.length - 1];
  };
  const mapping = {
    stock_availability: text => (text === 'no' ? 'no' : 'yes'),
    // offer_price: text => text.replace('€', ''),
    // original_price: text => text.replace('€', ''),
    weight_unit: text => takeUnit(text),
    colour: text => text.replace('Farba:', ''),
    // requestData: (text) => {
    //   const decodedData = Buffer.from(text, 'base64').toString('utf-8');
    //   // const jsonData = JSON.parse(decodedData);
    //   // const skusArray = jsonData.data.skus;
    //   // return skusArray[0].skuCd;
    //   const match = decodedData.match(/(\d+) recenzií/);
    //   return match ? match[1] : 'no match';
    // },
  };

  const mappingFct = (header, arr, row) => [...arr.map(({ text, ...other }) => ({ text: mapping[header](text, row), ...other }))];
  data.forEach(obj => obj.group.forEach(row => Object.keys(row).forEach((header) => {
    // eslint-disable-next-line no-param-reassign
    if (mapping[header]) row[header] = mappingFct(header, row[header], row);
  })));

  return data;
};

module.exports = { cleanUp };
