/* eslint-disable consistent-return */
const cleanUp = (data) => {
  const brandName = (text, isMobil1) => (isMobil1 ? 'Mobil 1' : text);
  const brandRegex = /(John Deere|Pennzoil|Super Tech|Valvoline|Castrol|Quaker State|Motorcraft|Lucas Oil|Shell|Mobil Delvac|Havoline|Royal Purple|Delo|Chevron|Liqui Moly|Ambrosia|KROON OIL|Briggs & Stratton|Mobil 1|Mobil|MOBIL 1|MOBIL|Yamaha|Kawasaki|Hyper Tough|Quicksilver|DELO)/gi;

  const mapping = {
    inStockOnline: (text) => {
      if (text.includes('nicht auf Lager')) {
        return 'no';
      }
      return 'yes';
    },
    productDescription: text => text.replace(/\n/g, ' '),
    RRP_Was: (text, row) => (text === 'dummy' ? row?.retailPrice?.[0].text : text),
    startingPriceType: (text) => {
      if (text.includes('UVP')) {
        return 'Was';
      }
      return 'RRP';
    },
    productVariant: (text, row) => {
      const sku = row?.sku?.[0]?.text || '';
      const viscosity = row?.viscosity?.[0]?.text || '';
      const mpn = row?.manufacturerPartNumber?.[0]?.text || '';
      const masterBrand = row?.masterBrand?.[0]?.text || '';
      const volumeRegex = /\b\d+(\.\d+)?\s*(?:quarts?|oz|gals?|ml|litre|litres|L|-\s*litre)\b/gi;
      return `${text.replace(',', '')
        .replace(volumeRegex, '')
        .replace(mpn, '')
        .replace(masterBrand, '')
        .replace(sku, '')
        .trim()} ${viscosity}`;
    },
    brandVariant: (text, row) => {
      const brand = brandName(row.masterBrand?.[0]?.text, row.checkIfMobil1);
      const sku = row?.sku?.[0]?.text || '';
      const mpn = row?.manufacturerPartNumber?.[0]?.text || '';
      const viscosityRegex = /\b\d{1,2}W[-\s]?\d{1,2}\b[,.]?/g;
      const volumeRegex = /\b\d+(\.\d+)?\s*(?:quarts?|oz|gals?|ml|litre|litres|L|-\s*litre)\b/gi;
      return text.replace(brand, '')
        .replace(sku, '')
        .replace(mpn, '')
        .replace(brandRegex, '')
        .replace(viscosityRegex, '')
        .replace(volumeRegex, '')
        .trim()
        .replace(/,+$/, '')
        .replace(/^,/, '')
        .replace(/,(\s*,)+/g, ',');
    },
    brand: (text, row) => {
      const sku = row?.sku?.[0]?.text || '';
      const mpn = row?.manufacturerPartNumber?.[0]?.text || '';
      const masterBrand = row?.masterBrand?.[0]?.text || '';
      const volumeRegex = /\b\d+(\.\d+)?\s*(?:quarts?|oz|gals?|ml|litre|litres|L|-\s*litre)\b/gi;
      const Brand = brandName(masterBrand, row.checkIfMobil1);
      if (Brand.includes('Mobil 1')) {
        return 'Mobil 1';
      }
      return `${text.replace(',', '')
        .replace(volumeRegex, '')
        .replace(mpn, '')
        .replace(Brand, '')
        .replace(sku, '')
        .trim()}`;
    },
    viscosity: (text, row) => (text === 'dummy' ? row?.viscosity_backup?.[0]?.text : text),
  };

  const mappingFct = (header, arr, row) => [...arr.map(({ text, ...other }) => ({ text: mapping[header](text, row), ...other }))];

  data.forEach(obj => obj.group.forEach(row => Object.keys(row).forEach((header) => {
    // eslint-disable-next-line no-param-reassign
    if (mapping[header]) row[header] = mappingFct(header, row[header], row);
  })));
  return data;
};

module.exports = { cleanUp };
