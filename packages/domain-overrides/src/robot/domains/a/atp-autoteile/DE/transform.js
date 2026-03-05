/* eslint-disable no-param-reassign */
/**
 *
 * @param {ImportIO.Group[]} data
 * @returns {ImportIO.Group[]}
 */
const cleanUp = (data) => {
  const volumeRegex = /\b\d+(?:\.\d+)?\s*(?:quarts?|oz|oz|Quart|Qt|QT|gals|ml|liter|Liter|litre|litres|Gallon|GAL|l|L|-\s*litre)\b/g;
  const getSingleVolume = (expr) => {
    expr.replace(/=\s*(\d+)/, '');
    const volumes = expr.match(volumeRegex);
    return volumes?.[0]?.replace(/[^\d]/g, '') ?? null;
  };
  const calculateVolume = (expr) => {
    const res = expr.match(/=\s*(\d+)/);
    if (res) return res?.[1];
    const clean = expr.replace(/[^\d*xX+]/g, '');
    const multiplications = clean.split('+');
    const products = multiplications.map(mult => mult.split(/[*xX]/)?.map(num => Number(num)).reduce((a, b) => a * b, 1));
    return String(products.reduce((a, b) => a + b, 0));
  };
  const hasDifferentSizes = expr => expr.match(/\+/);
  const mapping = {
    productName: (text, row) => {
      const masterBrand = row.masterBrand?.[0]?.text;
      return `${masterBrand} ${text.replace(masterBrand, '')}`;
    },
    productVariant: (text, row) => {
      let viscosity = row?.viscosity?.[0]?.text;
      // eslint-disable-next-line no-useless-escape
      const viscosityRegex = /\b\d{1,2}W[-\s]?\d{1,2}\b[.]?|SAE\s\b\d{1,2}W[\/\s]?\d{1,2}\b[.]?/;
      const viscosityRegexMatch = (viscosityRegex.exec(text) || [])[0] || '';
      const mpn = row?.manufacturerPartNumber?.[0]?.text || '';
      const masterBrand = row?.masterBrand?.[0]?.text || '';
      const sku = row?.sku?.[0]?.text || '';
      if (row.specificationProfile) {
        const concatenated = row?.specificationProfile?.map(item => item?.text).join(' ');
        row.specificationProfile = [{ text: concatenated?.replace(/,/g, '') }];
      }
      if (row.productDescription) {
        const concatenated = row?.productDescription?.map(item => item?.text).join(' ');
        row.productDescription = [{ text: concatenated?.replace(/,/g, '') }];
      }
      if (!row.viscosity?.[0].text) {
        viscosity = viscosityRegexMatch || '';
        row.viscosity = [{ text: viscosity }];
      }
      // brandVariant from the product name.
      const quantityRegex = /\d+x/;
      row.brand = [{
        text: text
          .replace(viscosity, '')
          .replace(quantityRegex, '')
          .replace(viscosityRegexMatch, '')
          .replace(volumeRegex, '')
          .replace(masterBrand, '')
          .replace(/MOTORÖL|Motoröl/g, '')
          .replace(mpn, '')
          .replace(/[–-]/, '')
          .trim()
          .split(' ')?.[0],
      }];
      // brandVariant from the product name.
      row.brandVariant = [{
        text: text
          .replace(/,/g, '')
          .replace(volumeRegex, '')
          .replace(viscosity, '')
          .replace(viscosityRegexMatch, '')
          .replace(quantityRegex, '')
          .replace(masterBrand, '')
          .replace(mpn, '')
          .replace(/MOTORÖL|Motoröl/g, '')
          .replace(':', '')
          .replace(sku, '')
          .replace(/,(\s*,)+/g, ',')
          .replace(/\s+/g, ' ')
          .trim(),
      }];
      return `${text.replace(/,/g, '')
        .replace(volumeRegex, '')
        .replace(viscosity, '')
        .replace(viscosityRegexMatch, '')
        .replace(quantityRegex, '')
        .replace(masterBrand, '')
        .replace(mpn, '')
        .replace(/MOTORÖL|Motoröl/g, '')
        .replace(':', '')
        .replace(sku, '')
        .replace(/,(\s*,)+/g, ',')
        .replace(/\s+/g, ' ')
        .trim()} ${viscosity}`;
    },
    packSize: (text, row) => {
      if (text !== 'empty') {
        if (hasDifferentSizes(text)) return calculateVolume(text);
        return getSingleVolume(text);
      }
      const matches = row.productName?.[0]?.text?.match(volumeRegex)?.[0];
      if (matches) return matches.match(/(\d+)/)[1];
      return row.packSizeBackup?.[0]?.text ?? null;
      // const packSizeMatch = text.match(volumeRegex)?.pop(); // take the last one as it should be the correct one
      // if (packSizeMatch) {
      //   const quantity = packSizeMatch.match(/(\d+)/)[1];
      //   const unit = packSizeMatch.match(/(\D+)/)[1];
      //   // eslint-disable-next-line no-param-reassign
      //   row.packSizeUnit = [{ text: unit || '' }];
      //   return quantity;
      // }
      // return 'No Data Found';
    },
    inStockOnline: (text) => {
      if (text?.includes('no')) {
        return 'no';
      }
      return 'yes';
    },
    multipackFlag: (text) => {
      if (text?.includes('no')) {
        return 'no';
      }
      return 'yes';
    },
    multipackQuantity: (text) => {
      if (hasDifferentSizes(text)) return text;
      const quantityRegex = /(\d+)x/g;
      if (text) {
        let totalQuantity = 0;
        let match = quantityRegex.exec(text);
        while (match !== null) {
          totalQuantity += parseInt(match[1], 10);
          match = quantityRegex.exec(text);
        }
        // console.log(totalQuantity);
        return totalQuantity?.toString();
      }
      return '';
    },
    retailPrice: (text, row) => {
      const regex = /-\d+%/g;
      const formatted = regex.exec(text) ? text.replace(/\./g, '') : text;
      if (formatted.includes('%')) {
        // console.log('Discount')
        const RRPWASRegex = /UVP\s(\d+,\d+)[\S\s]+\s-\d+%/;
        const retailPriceRegex = /(\d+,\d+)[\S+\s+]€\s+UVP/;
        const RrpWasMatch = RRPWASRegex.exec(formatted);
        const retailMatch = retailPriceRegex.exec(formatted);
        if (RrpWasMatch) {
          // eslint-disable-next-line no-param-reassign
          const rrpWas = RrpWasMatch[1].replace(',', '.');
          const number = parseFloat(rrpWas);
          row.RRP_Was = [{ text: rrpWas }];
          // console.log(row.RRP_Was)
          row.RRP_WasWithoutVat = [{ text: (number * 0.81).toFixed(2).toString() }];
          // console.log(row.RRP_WasWithoutVat)
          // eslint-disable-next-line no-param-reassign
          row.startingPriceType = [{ text: 'Was' }];
          const retailPriceNumber = parseFloat(retailMatch[1]?.replace(',', '.'));
          row.retailPriceWithoutVAT = [{ text: (retailPriceNumber * 0.81)?.toFixed(2)?.toString() }];
          // console.log(row.retailPriceWithoutVAT);
          return retailMatch ? retailMatch[1].replace(',', '.') : RrpWasMatch[1].replace(',', '.');
        }
      }
      // console.log('No discount')
      const thousandRegex = /(\d+)\./;
      const thousandMatch = thousandRegex.exec(text);
      // eslint-disable-next-line no-param-reassign
      const withThousand = formatted.replace('€', '')
        .trim()
        .replace(/\d\./g, thousandMatch ? thousandMatch[1] : '')
        .replace(',', '.');
      const noThousand = formatted.replace('€', '').replace(',', '.').trim();
      row.RRP_Was = [{ text: thousandMatch ? withThousand : noThousand }];
      // console.log(row.RRP_Was)
      // eslint-disable-next-line no-multi-assign
      row.RRP_WasWithoutVat = row.retailPriceWithoutVAT = [{
        text: thousandMatch ? (parseFloat(withThousand) * 0.81).toFixed(2).toString()
          : (parseFloat(noThousand) * 0.81).toFixed(2).toString(),
      }];
      // console.log(row.RRP_WasWithoutVat);
      // eslint-disable-next-line no-param-reassign
      row.startingPriceType = [{ text: 'RRP' }];
      return thousandMatch ? withThousand : noThousand;
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
