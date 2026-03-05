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
  const cleanTitle = text => (text ? regexToRemove.reduce((out, cur) => out?.replace(cur, ''), text) : text);
  const volumeFromPrice = (row) => {
    const price = Number(row.retailPrice?.[0]?.text);
    if (Number.isNaN(price)) return null;
    const pricePerOunce = Number(row.pricePerOunce?.[0]?.text);
    if (!Number.isNaN(pricePerOunce)) return `${Math.round((price * 100) / pricePerOunce)} fl oz`;
    const pricePerQuart = Number(row.pricePerQuart?.[0]?.text);
    if (!Number.isNaN(pricePerQuart)) return `${Math.round((price * 100) / pricePerQuart)} qt`;
    return null;
  };
  const mapping = {
    sku: (text, row) => {
      if (text !== 'empty') return text;
      return row.sku_backup?.[0]?.text ?? null;
    },
    productDescription: text => text.replace(/,/g, ''),
    specificationProfile: text => text.match(/(MEETS|[Mm]eets)(.+)/g)?.join('\n')?.replace(/,/g, '') ?? null,
    brand: (text, row) => {
      const brandName = (text !== 'empty') ? text : (row.brand_backup?.[0]?.text ?? null);
      const productName = row.productName?.[0]?.text ?? null;
      const viscosity = row.viscosity?.[0]?.text ?? '';
      const viscosityRegex = RegExp(`(SAE\\s)?${viscosity?.replace(' ', '\\s*')}`, 'ig');
      const brandVariant = cleanTitle(productName?.replace(brandName, '')?.replace(viscosityRegex, '')?.replace(/(SAE\s)?\d+[Ww]\s?-?\s?\d+/, '')) ?? null;
      row.brandVariant = [{ text: brandVariant }];

      const productVariant = `${brandVariant}, ${viscosity?.replace(' - ', '-')}`;
      row.productVariant = [{ text: productVariant }];

      const productTitle = `${brandName}, ${viscosity?.replace(' - ', '-')}`;
      row.productTitle = [{ text: productTitle }];

      row.productReviews = [{ text: row.productReviews?.[0]?.text ?? null }];
      row.masterBrand = [{ text: brandName }];
      return brandName;
    },
    productName: (text, row) => {
      const packItems = Number(text.match(/\(Pack of (\d+)\)/i)?.[1] ?? text.match(/\((\d+)\s*pack\)/i)?.[1]);
      row.isBundle = [{ text: packItems > 1 ? 'yes' : 'no' }];
      return text;
    },
    RRP_Was: (text, row) => {
      if (text !== 'empty') return text;
      return row.retailPrice?.[0]?.text ?? null;
    },
    packSize: (text, row) => {
      const packSizeRaw = (text !== 'empty')
        ? text
        : row.packSize_backup?.[0]?.text
          ?? row.packSize_backup2?.[0]?.text
          ?? volumeFromPrice(row);
      row.packSizeUnit = [{ text: packSizeRaw?.replace(/[\d.]+[\s-]*/, '') }];
      const converted = packSizeRaw?.match(/(\d+(.\d+)?)/)?.[1] ?? (packSizeRaw?.match(/^(?:Quart|Gallon|Ounce|Pint)$/) && 1);
      return converted ? `${Number(converted)}` : converted;
    },
    promoPrice: (text, row) => `-${String(Math.round((Number(text) / Number(row.RRP_Was?.[0]?.text)) * 100))}%`,
    // variantURL: (text, row) => {
    //   if (text !== 'empty') return text;
    //   return row.currentURL?.[0]?.text ?? '';
    // },
    currentVariantURL: (text, row) => {
      row.variantURL = row.variantURL?.filter(variant => variant.text !== text) ?? [];
      return text;
    },
    manufacturerPartNumber: (text, row) => {
      if (text !== 'empty') return text;
      return row.manufacturerPartNumber_backup?.[0].text ?? null;
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
