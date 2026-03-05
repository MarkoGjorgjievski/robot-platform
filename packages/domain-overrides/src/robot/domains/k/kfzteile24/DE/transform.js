/* eslint-disable no-irregular-whitespace */
/* eslint-disable no-param-reassign */
/**
 *
 * @param {ImportIO.Group[]} data
 * @returns {ImportIO.Group[]}
 */
const cleanUp = (data) => {
  // function removeVAT(price) {
  //   const numericPrice = parseFloat(price.replace(/,/g, '.'));
  //   return numericPrice / 1.19;
  // }

  function isBase64Encoded(text) {
    const base64Regex = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

    if (typeof text !== 'string' || !text.length || !base64Regex.test(text)) {
      return false;
    }

    try {
      const decoded = Buffer.from(text, 'base64').toString('utf-8');
      return !!decoded;
    } catch (e) {
      return false;
    }
  }

  function decodeIfBase64(text) {
    if (isBase64Encoded(text)) {
      try {
        const decoded = Buffer.from(text, 'base64').toString('utf-8');
        return JSON.parse(decoded);
      } catch (e) {
        return Buffer.from(text, 'base64').toString('utf-8');
      }
    }
    return text;
  }

  const mapping = {
    productURL: text => decodeIfBase64(text),
    productVariant: (text, row) => {
      const viscosityData = row?.viscosity?.[0].text;
      const textWithoutViscosityAndCapacity = text.replace(viscosityData, '').replace(/\s*\(.*?\)/, '');
      return `${textWithoutViscosityAndCapacity} ${viscosityData}`;
    },
    brandVariant: (text, row) => {
      const viscosityData = row?.viscosity?.[0].text;
      return text.replace(viscosityData, '').replace(/\s*\(.*?\)/, '');
    },
    brand: (text, row) => {
      const viscosityData = row?.viscosity?.[0].text;
      return text.replace(viscosityData, '').replace(/\s*\(.*?\)/, '');
    },
    retailPrice: text => text.replace(',', '.'),
    // retailPriceWithoutVAT: text => removeVAT(text).toFixed(2).toString().replace(',', '.'),
    RRP_Was: (text, row) => {
      if (text !== 'dummy') return text.replace(',', '.');
      return row?.retailPrice?.[0].text.replace(',', '.');
    },
    // RRP_WasWithoutVat: (text, row) => {
    //   if (text !== 'dummy') return removeVAT(text).toFixed(2).toString().replace(',', '.');
    //   const price = row?.retailPrice?.[0].text;
    //   return removeVAT(price).toFixed(2).toString().replace(',', '.');
    // },
    packSize: text => text.replace(',', '.'),
    // specificationProfile: (text, row) => row.specificationProfileRow?.map(dataRow => dataRow.text)?.join('\n') ?? text,
  };

  const mappingFct = (header, arr, row) => [...arr.map(({ text, ...other }) => ({ text: mapping[header](text, row), ...other }))];

  data.forEach(obj => obj.group.forEach(row => Object.keys(row).forEach((header) => {
    // eslint-disable-next-line no-param-reassign
    if (mapping[header]) row[header] = mappingFct(header, row[header], row);
  })));
  return data;
};

module.exports = { cleanUp };
