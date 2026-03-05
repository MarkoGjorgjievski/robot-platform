/* eslint-disable no-irregular-whitespace */
/* eslint-disable no-param-reassign */
/**
 *
 * @param {ImportIO.Group[]} data
 * @returns {ImportIO.Group[]}
 */
const cleanUp = (data) => {
  const mapping = {
    brand: (text, row) => {
      const masterBrandData = row?.masterBrand?.[0].text;
      return text.replace(masterBrandData, '');
    },
    brandVariant: (text, row) => {
      const masterBrandData = row?.masterBrand?.[0].text;
      const viscosityData = row?.viscosity?.[0].text;
      return text.replace(masterBrandData, '').replace(viscosityData, '');
    },
    productVariant: (text, row) => {
      const masterBrandData = row?.masterBrand?.[0].text;
      const viscosityData = row?.viscosity?.[0].text;
      const brandVariant = text.replace(masterBrandData, '').replace(viscosityData, '');
      return viscosityData ? `${brandVariant} ${row?.viscosity?.[0].text}` : brandVariant;
    },
    RRP_WasWithoutVat: (text, row) => (row?.promotionDescription?.[0]?.text ? text : null),
    packSize: (text) => {
      const regex = /(?:\s|[xX])(\d+(?:\.\d+)?(?:[xX]\d+(?:\.\d+)?)?)\s*(L|KG|g|ml)\b/gi;
      const match = regex.exec(text);
      if (!match) return null;
      const split = match[1] ? match[1].split(/x/i) : '';
      return split[1] || split[0];
    },
    packSizeUnit: (text) => {
      const regex = /(?:\s|[xX])(\d+(?:\.\d+)?(?:[xX]\d+(?:\.\d+)?)?)\s*(L|KG|g|ml)\b/gi;
      const match = regex.exec(text);
      return (match && match[2]) ? match[2] : null;
    },
  };

  const mappingFct = (header, arr, row) => [...arr.map(({ text, ...other }) => ({ text: mapping[header](text, row), ...other }))];

  data.forEach(obj => obj.group.forEach(row => Object.keys(row).forEach((header) => {
    // eslint-disable-next-line no-param-reassign
    if (mapping[header]) row[header] = mappingFct(header, row[header], row);
  })));
  return data;
};

module.exports = { cleanUp };
