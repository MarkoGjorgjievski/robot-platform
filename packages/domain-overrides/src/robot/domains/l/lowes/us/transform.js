/* eslint-disable sonarjs/no-duplicate-string */
/* eslint-disable no-param-reassign */
/**
 *
 * @param {ImportIO.Group[]} data
 * @returns {ImportIO.Group[]}
 */
const cleanUp = (data) => {
  const getBrandVariantData = (title, description) => {
    const text = `${title} ${description}`;
    if (text.toUpperCase().includes('EDGE')) return 'EDGE';
    if (text.toUpperCase().includes('GTX')) return 'GTX';
    if (text.toUpperCase().includes('AXIS')) return '';
    if (text.toUpperCase().includes('CRAFTSMAN')) return '';
    if (text.toUpperCase().includes('MAG 1')) return 'MAG 1';
    if (text.toUpperCase().includes('MOBIL DEL')) return 'DELVAC';
    if (text.toUpperCase().includes('MOBIL 1')) return 'MOBIL 1';
    if (text.toUpperCase().includes('PENNZOIL') && text.toUpperCase().includes('HIGH MILEAGE') && text.toUpperCase().includes('PLATINUM')) return 'PLATINUM HIGH MILEAGE';
    if (text.toUpperCase().includes('PENNZOIL') && text.toUpperCase().includes('HIGH MILEAGE')) return 'HIGH MILEAGE';
    if (text.toUpperCase().includes('PENNZOIL') && text.toUpperCase().includes('PLATINUM')) return 'PLATINUM';
    if (text.toUpperCase().includes('PENNZOIL') && text.toUpperCase().includes('ULTRA')) return 'ULTRA PLATINUM';
    if (text.toUpperCase().includes('PENNZOIL') && text.toUpperCase().includes('CONVENTIONAL')) return 'CONVENTIONAL';
    if (text.toUpperCase().includes('VALVOLINE') && text.toUpperCase().includes('ADVANCED')) return 'ADVANCED';
    if (text.toUpperCase().includes('VALVOLINE') && text.toUpperCase().includes('DAILY PROTECTION')) return 'DAILY PROTECTION';
    if (text.toUpperCase().includes('VALVOLINE') && text.toUpperCase().includes('HIGH MILEAGE WITH MAXLIFE TECHNOLOGY')) return 'HIGH MILEAGE WITH MAXLIFE TECHNOLOGY';
    if (text.toUpperCase().includes('VALVOLINE') && text.toUpperCase().includes('HIGH MILEAGE')) return 'HIGH MILEAGE';
    if (text.toUpperCase().includes('ROTELLA')) return 'ROTELLA';
    return '';
  };

  const mapping = {
    manufacturerPartNumber: text => text.replace('MOBI', ''),
    masterBrand: (text) => {
      if (text.toUpperCase().includes('ROTELLA')) return 'Shell';
      return text.includes('1') ? text.split(' ')[0] : text;
    },
    brand: (text, row) => getBrandVariantData(text, row?.productDescription?.[0]?.text),
    brandVariant: (text, row) => getBrandVariantData(text, row?.productDescription?.[0]?.text),
    productVariant: (text, row) => {
      const brandVariantData = getBrandVariantData(text, row?.productDescription?.[0]?.text);
      const viscosityData = row?.viscosity?.[0].text;
      return viscosityData ? `${brandVariantData} ${viscosityData}` : brandVariantData;
    },
    isBundle: text => (text === '1' ? 'No' : 'Yes'),
    RRP_Was: (text, row) => {
      if (text !== 'dummy') return text;
      return row?.retailPrice?.[0].text;
    },
    packSize: (text, row) => {
      if (text !== 'dummy') return text;
      const match = row?.packSizeBackup?.[0]?.text.match(/(\d+(\.\d+)?\s*-?\s*(?:Quart|Qt|Litre|Gallon|Gal?|Millilitre|ml|oz|liters?|quarts?|gallons?|fl oz))/i);
      const matchOnlyUnit = row?.packSizeBackup?.[0]?.text.match(/\b(?:Quart|Qt|Litre|Gallon|Gal?|Millilitre|ml|oz|liters?|quarts?|gallons?|fl oz?)\b/gmi);
      if (match && match[0].includes('-')) return match[0].split('-')[0];
      if (match) return match[0].split(' ')[0];
      return matchOnlyUnit ? '1' : null;
    },
    packSizeUnit: (text, row) => {
      if (text !== 'dummy') return text;
      const match = row?.packSizeBackup?.[0]?.text.match(/(\d+(\.\d+)?\s*-?\s*(?:Quart|Qt|Litre|Gallon|Gal?|Millilitre|ml|oz|liters?|quarts?|gallons?|fl oz))/i);
      const matchOnlyUnit = row?.packSizeBackup?.[0]?.text.match(/\b(?:Quart|Qt|Litre|Gallon|Gal?|Millilitre|ml|oz|liters?|quarts?|gallons?|fl oz?)\b/gmi);
      if (match && match[0].includes('-')) return match[0].split('-')[1];
      if (match) return match[0].split(' ')[1];
      return matchOnlyUnit ? matchOnlyUnit[0] : null;
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
