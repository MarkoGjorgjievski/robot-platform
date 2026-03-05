/* eslint-disable no-param-reassign */

/**
 *
 * @param {ImportIO.Group[]} data
 * @returns {ImportIO.Group[]}
 */
const cleanUp = (data) => {
  const regexToRemove = [
    /\([^)]+\)/g,
    /([.\d]+\s*-?\s*(?:oz|Quarts?|Gallons?|Gal|GAL|OZ|PT|qt|QT|Qt|Ounces?|Pints?|pt|gal|Liters?)|(?:Quart|Gallon|Ounce|Pint))/i,
    /\s+\.$/,
    /\s+$/g,
    /^\s+/g,
    /^,\s*/,
    /\s,(\s+|$)/g,
    /,\s*$/g,
    /\s-\s*$/,
    /,\s*-/,
  ];
  const lineMap = {
    ACD: 'ACDelco',
    CAS: 'Castrol',
    CHV: 'Chevron',
    MOB: 'Mobil',
    MOT: 'Motorcraft',
    ORO: 'O\'Reilly',
    PEN: 'Pennzoil',
    PNT: 'Pentosin',
    RL: 'Red Line',
    SHE: 'Shell',
    SNT: 'Syntec',
    VAL: 'Valvoline',
    LUC: 'Lucas',
    MYS: 'Mystik',
    RYP: 'Royal Purple',
    SIE: 'Sierra',
    PRI: 'Prime Line',
    ATV: 'Prime Line',
    PHL: 'Phillips',
    OIL: 'Pure Guard',
    MP2: 'MasterPro',
    MPM: 'MasterPro', // conventional
    CHP: 'Champion',
    VPF: 'VP Racing Fuels',
    AML: 'Amalie Mineral',
    COM: 'Comp Cams',
  };
  const removeCommas = text => text?.replace(/,/g, '');
  const trimLines = text => text?.split('\n')?.map(txt => txt.trim())?.filter(txt => !txt.match(/^\s*$/))?.join('\n');
  const cleanTitle = text => (text ? regexToRemove.reduce((out, cur) => out.replace(cur, ''), text) : text);
  //   const volumeFromPrice = (row) => {
  //     const price = Number(row.retailPrice?.[0]?.text);
  //     const pricePerOunce = Number(row.pricePerOunce?.[0]?.text);
  //     if (Number.isNaN(price) || Number.isNaN(pricePerOunce)) return null;
  //     return `${Math.round((price * 100) / pricePerOunce)} fl oz`;
  //   };
  const mapping = {
    sku: (text, row) => `${text} ${row?.sku2?.[0]?.text}`,
    masterBrand: text => lineMap[text] ?? text,
    brand: (text, row) => {
      const brandName = (text !== 'empty') ? text : (row.brand_backup?.[0]?.text ?? null);

      const productName = row.productName?.[0]?.text ?? null;
      const viscosity = row.viscosity?.[0]?.text ?? '';
      const viscosityRegex = RegExp(`(SAE\\s)?${viscosity.replace(' ', '\\s*')}`, 'ig');
      const brandVariant = cleanTitle(productName?.replace(brandName, '')?.replace(viscosityRegex, '')?.replace(/(SAE\s)?\d+[Ww]\s?-?\s?\d+/, '')) ?? null;
      row.brandVariant = [{ text: brandVariant }];

      const productVariant = `${brandName} ${brandVariant}, ${viscosity.replace(' - ', '-')}`;
      row.productVariant = [{ text: productVariant }];

      return productName?.match(/Castrol\s(Edge|GTX|Power|2T|Magnatec|Heavy Duty)/)?.[1] ?? brandName;
    },
    rawAvailabilityMessage: text => trimLines(text.match(/delivery method\.([\s\S]+)\nClose/)?.[1]),
    productDescription: text => trimLines(removeCommas(text)),
    specificationProfile: text => trimLines(removeCommas(text)),
    promotionDescription: (text, row) => {
      const first = text !== 'dummy' ? text : '';
      const second = row.promotionDescription2?.[0]?.text ?? '';
      return `${first}\n${second}`;
    },
    // productName: (text, row) => {
    //   const packItems = Number(text.match(/\(Pack of (\d+)\)/i)?.[1] ?? text.match(/\((\d+)\s*pack\)/i)?.[1]);
    //   row.isBundle = [{ text: packItems > 1 ? 'yes' : 'no' }];
    //   return text;
    // },
    RRP_Was: (text, row) => {
      if (text !== 'empty') return text;
      return row.retailPrice?.[0]?.text ?? null;
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
