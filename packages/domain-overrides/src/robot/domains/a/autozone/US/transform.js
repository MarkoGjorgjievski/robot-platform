/* eslint-disable no-param-reassign */
/**
 *
 * @param {ImportIO.Group[]} data
 * @returns {ImportIO.Group[]}
 */
const cleanUp = (data) => {
  function extractPrice(priceString) {
    const regex = /(\d+)\s+dollars?\s+and\s+(\d+)\s+cents?/i;
    const priceMatch = priceString.match(regex);

    if (priceMatch && priceMatch[1] && priceMatch[2]) {
      const dollars = parseInt(priceMatch[1], 10);
      const cents = parseInt(priceMatch[2], 10);
      return dollars + cents / 100;
    }
    return null;
  }

  const mapping = {
    masterBrand: text => text.split(' ')[0],
    brandVariant: (text, row) => {
      if (row?.retailPriceBundle) return text;
      const brandName = (txt) => {
        if (!txt) return null;
        if (txt.match('Mobil 1')) return 'Mobil 1';
        if (txt.match('Mobil')) return 'Mobil';
        if (txt.match('Shell')) return 'Shell';
        return txt;
      };
      const brand = brandName(row.brand?.[0].text);
      const viscosityRegex = /\b\d{1,2}W[-\s]?\d{1,2}\b[,.]?/g;
      const quartRegex = /\b\d+(\.\d+)?\s*(?:quarts?|oz|gals?|ml|l|Liter|Liters)\b/gi;
      const result = text.replace(brand, '').replace(viscosityRegex, '').replace(quartRegex, '').replace('Mobil 1', '');
      return result.replace(/\s{2,}/g, ' ').trim().replace(/,\s*,/g, ',').replace(/,\s*\./g, '.');
    },
    brand: (text, row) => {
      if (row?.retailPriceBundle) return text;
      const spilttedText = text.split(' ');
      if (spilttedText[0] === 'Mobil' && spilttedText[1] === '1') return 'Mobil 1';
      if (spilttedText[0] === 'Pennzoil' && spilttedText[1] === 'Ultra') return 'Ultra Platinum';
      if (spilttedText[1] === 'Engine') return null;
      return spilttedText[1];
    },
    productVariant: (text, row) => {
      if (row?.retailPriceBundle) return text;
      const quartRegex = /\b\d+(\.\d+)?\s*(?:quarts?|oz|gals?|ml|l|Gallon)\b/gi;
      return text.replace(quartRegex, '');
    },
    retailPrice: (text, row) => {
      if (text !== 'bundlePrice') {
        const cleanedPrice = extractPrice(text);
        return cleanedPrice ? cleanedPrice.toString() : text;
      }
      const regex = /\$\d+\.\d{2}/;
      const price = row?.retailPriceBundle?.[0]?.text.match(regex);
      return price && price[0].replace('$', '');
    },
    promoPrice: text => `-${text}`,
    packSize: (text, row) => {
      if (row?.retailPriceBundle) return text;
      if (text !== 'dummy') return text;
      const matchSize = row?.packSizeBackup?.[0]?.text.match(/(\d+(\.\d+)?\s*-?\s*(?:Quart|Qt|Litre|Gallon|Gal?|Millilitre|ml|oz|liters?|quarts?|gallons?|fl oz))/i);
      return matchSize ? matchSize[0].split(' ')[0] : null;
    },
    packSizeUnit: (text, row) => {
      if (row?.retailPriceBundle) return text;
      if (text !== 'dummy') return text;
      const match = row?.packSizeBackup?.[0]?.text.match(/(\d+(\.\d+)?\s*-?\s*(?:Quart|Qt|Litre|Gallon|Gal?|Millilitre|ml|oz|liters?|quarts?|gallons?|fl oz))/i);
      return match ? match[0].split(' ')[1] : null;
    },
    viscosity: (text, row) => {
      if (row?.retailPriceBundle) return text;
      if (text === 'empty' || text === 'Premix') return row.viscocity_backup?.[0]?.text ?? null;
      return text;
    },
    productDescription: text => text.replace(/,\s*/g, ' '),
    specificationProfile: text => text.replace(/,\s*/g, ' '),
  };

  const mappingFct = (header, arr, row) => arr.map(({ text, ...other }) => ({ text: mapping[header](text, row), ...other }));

  data.forEach(obj => obj.group.forEach(row => Object.keys(row).forEach((header) => {
    // eslint-disable-next-line no-param-reassign
    if (mapping[header]) row[header] = mappingFct(header, row[header], row);
  })));

  return data;
};

module.exports = { cleanUp };
