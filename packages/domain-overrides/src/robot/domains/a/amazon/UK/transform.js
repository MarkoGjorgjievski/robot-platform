/* eslint-disable no-param-reassign */
/**
 *
 * @param {ImportIO.Group[]} data
 * @returns {ImportIO.Group[]}
 */
const cleanUp = (data) => {
  const brandName = (text, isMobil1) => (isMobil1 ? 'Mobil 1' : text);

  function isOnlyDigits(input) {
    const digitRegex = /^\d+$/;
    return digitRegex.test(input);
  }

  const regexes = {
    viscosity: /\b\d{1,2}\s*[wW]\s*[-\s]?\d{1,2}\b[,.]?/g,
    volume1: /\b\d+(\.\d+)?\s*(?:L|litre|litres|liter|liters|ml)\b(?:\s*Volume)?/gi,
    volume2: /\b\d+(\.\d+)?\s*(?:quarts?|oz|gals?|ml|litre|litres|L|-\s*litre)\b/gi,
    sku: /\|\s*SKU:\s*\d+/gi,
  };

  const cleanText = (text, brand = '', sku = '') => text.replace(regexes.volume1, '')
    .replace(regexes.volume2, '')
    .replace(regexes.sku, '')
    .replace(brand, '')
    .replace(sku, '')
    .replace('|', '')
    .replace('pack of one', '')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .replace(/,\s*,/g, ',')
    .replace(/,\s*\./g, '.')
    .replace(',', '');

  const dimensionsHash = {
    L: 'length',
    W: 'width',
    H: 'height',
    D: 'depth',
    h: 'height',
    '.': 'length', // ! exception - P. appears for length
  };
  const dimensionsUnitHash = {
    centimetres: 'cm',
    centímetros: 'cm',
    cm: 'cm',
    mm: 'mm',
    in: 'in',
    metres: 'm',
    millimeters: 'mm',
    millimetres: 'mm',
    milímetros: 'mm',
    inches: 'inches',
    pulgadas: 'inches',
  };
  const weightHash = {
    pounds: 'lbs',
    grams: 'g',
    gramos: 'g',
    kilograms: 'kg',
    kilogramos: 'kg',
    ounces: 'oz',
    kg: 'kg',
    g: 'g',
  };
  const units = {
    m: {
      cm: 100,
      mm: 1000,
      m: 1,
      inches: 39.3701,
      in: 39.3701,
    },
    cm: {
      cm: 1,
      mm: 10,
      m: 0.01,
      inches: 0.393701,
      in: 0.393701,
    },
    mm: {
      cm: 0.1,
      mm: 1,
      m: 0.001,
      inches: 0.0393701,
      in: 0.0393701,
    },
    inches: {
      cm: 2.54,
      mm: 25.4,
      m: 0.0254,
      inches: 1,
      in: 1,
    },
  };

  const convert = value => ({ from: fromUnit => ({ to: toUnit => (+value * units[fromUnit][toUnit]) }) });
  const urlFunction = (productReviewsURL, productTitle) => {
    const arr = productReviewsURL.split('/product-reviews/');
    return `${arr[0]}${productTitle}product-reviews/${arr[1]}`;
  };

  function formatDateToISO(dateString) {
    // Extract the date components from the string
    const dateComponents = dateString.match(/(\d{1,2}) (\w+) (\d{4})/);

    // Months mapping to convert month name to month number
    const months = {
      January: 0,
      February: 1,
      March: 2,
      April: 3,
      May: 4,
      June: 5,
      July: 6,
      August: 7,
      September: 8,
      October: 9,
      November: 10,
      December: 11,
    };

    // Extract day, month, and year from date components
    const day = parseInt(dateComponents[1], 10);
    const month = months[dateComponents[2]];
    const year = parseInt(dateComponents[3], 10);

    // Create a new Date object
    const date = new Date(year, month, day);

    // Return ISO string representation of the date
    return date.toISOString().split('T')[0];
  }
  const correctRank = (str) => {
    const arr = str.split(' ');
    return arr[0];
  };
  const mapping = {
    screenshot: (text, row) => {
      if (!row?.resellerName && !row?.resellerId) {
        row.resellerName = [{ text: 'Amazon' }];
        row.resellerId = [{ text: 'N/A' }];
      }
      return text;
    },
    ranking: text => (text ? correctRank(text) : null),
    review_date: text => (text ? formatDateToISO(text) : null),
    weight_unit: text => (text ? weightHash[text.toLowerCase()] : null),
    product: (text, row) => {
      // row.productReviewsURL = [{ text: 'gamarjoba' }]; works
      // row.productReviewsURL = [{ text: `${row.productReviewsURL?.[0]?.text} gamarjoba gamarjoba` }];
      row.productReviewsURL = [{ text: urlFunction(row.productReviewsURL?.[0]?.text, row.productTitle?.[0]?.text) }];
    },
    product_title: (text, row) => {
      let dimensionsUnit = null;
      let dimensions = null;
      let weight = null;
      if (row.product_dimensions) {
        // eslint-disable-next-line no-irregular-whitespace
        const productDimensions = row.product_dimensions?.[0]?.text.replace(/[\u00A0\u200a​\u200b​\u200e]/g, '');
        const productDimensionsSplit = productDimensions.split(';');

        if (!row.dimensions) {
          dimensions = productDimensionsSplit[0].trim();
        }

        if (productDimensionsSplit[1]) {
          weight = productDimensionsSplit[1].trim();
        }
      }

      if (row.package_dimensions) {
        // eslint-disable-next-line no-irregular-whitespace
        const packageDimensions = row.package_dimensions?.[0]?.text.replace(/[\u00A0\u200a​\u200b​\u200e]/g, '');
        const packageDimensionsSplit = packageDimensions.split(';');

        if (packageDimensionsSplit[1] && !weight) {
          weight = packageDimensionsSplit[1].trim();
        }
      }

      if (row.dimensions) {
        if (row.dimensions?.[0]?.text.includes(';')) {
          dimensions = row.dimensions?.[0]?.text?.split(';')[0];
          weight = row.dimensions?.[0]?.text?.split(';')[1]?.trim();
        } else {
          dimensions = row.dimensions?.[0]?.text;
        }
      }

      if (dimensions) {
        const parts = dimensions.split(' ').filter(part => part !== 'x').map(n => n.replace(',', '.'));
        dimensionsUnit = dimensionsUnitHash[parts[parts.length - 1].toLowerCase()];
        row.dimensions_unit = [{ text: dimensionsUnit }];
        parts.pop();

        if (+parts[0]) {
          ['length', 'width', 'height'].forEach((dim, index) => {
            row[dim] = [{ text: parts[index] }];
          });
        } else {
          parts.forEach((part) => {
            row[dimensionsHash[part[part.length - 1]]] = [{ text: `${parseFloat(part.replace(',', '.'))}` }];
          });
        }
      }

      if (row.diameter_dimension) {
        // eslint-disable-next-line no-irregular-whitespace
        const diameter = row.diameter_dimension?.[0]?.text.replace(/[\u00A0\u200a​\u200b​\u200e]/g, '').split(' ');

        const raw = diameter[0].replace(',', '.');
        const unit = diameter[1];

        if (+raw && unit) {
          let diameterRaw = raw;
          const diameterUnit = dimensionsUnitHash[unit.toLowerCase()];

          if (row.dimensions_unit && diameterUnit !== row.dimensions_unit?.[0]?.text) {
            diameterRaw = `${convert(diameterRaw).from(diameterUnit).to(row.dimensions_unit?.[0]?.text)}`;
          }

          if (!row.dimensions_unit) {
            row.dimensions_unit = [{ text: diameterUnit }];
          }

          row.diameter = [{ text: diameterRaw }];
        }
      }

      if (row.colours) {
        row.colour = [{ text: row.colours?.[0]?.text }];
      }

      if (weight && !row.weight_raw && !row.weight_unit) {
        const weightSplit = weight.split(' ');
        row.weight_raw = [{ text: weightSplit[0] }];
        row.weight_unit = [{ text: weightHash[weightSplit[1].toLowerCase()] }];
      }

      if (row.offer_prices) {
        if (row.original_price && row.original_price?.[0]?.text === row.offer_prices?.[0]?.text) {
          row.offer_price = null;
        } else {
          row.offer_price = [{ text: row.offer_prices?.[0]?.text }];
        }
      }

      row.dimensions = null;
      row.product_dimensions = null;

      return text || 'Title not available';
    },
    product_vars: (text, row) => {
      let baseUrl = '';
      let prodVars = [];
      if (row.link) {
        baseUrl = row.link[0]?.text.split('/dp/')[0];
      }
      if (row.select_variations) {
        prodVars = row.select_variations.map(sv => ({ text: `${baseUrl}/dp/${sv.text.split(',')[1]}` }));
      }
      if (row.tile_variations) {
        row.tile_variations.map(tv => prodVars.push({ text: `${baseUrl}${tv.text}`.includes('/dp/') ? `${baseUrl}${tv.text}` : `${baseUrl}/dp/${tv.text}` }));
      }

      row.select_variations = null;
      row.tile_variations = null;
      row.product_variations = prodVars.length ? prodVars : null;

      return null;
    },
    pack_size: text => text?.trim(),
    listing_id: (text, row) => (row.qid ? `${text}/${row.qid[0]?.text}` : text),
    stock_availability: (text) => {
      const statuses = ['Add to Cart', 'Add to Basket', 'In stock', 'Añadir a la cesta', 'En stock'];
      const checkStatus = statuses.some(status => status.toLowerCase().trim() === text.toLowerCase().trim());
      return checkStatus ? 'yes' : 'no';
    },
    user_reviews: text => (text ? text.replace(/[.,]/, '') : null),
    // BP transform
    brandVariant: (text, row) => {
      const sku = row.sku?.[0]?.text || row.skuBackup?.[0]?.text;
      const brand = brandName(row?.brand?.[0]?.text.trim(), row.checkIfMobil1);
      const cleanedText = cleanText(text, brand, sku);
      return cleanedText.replace(regexes.viscosity, '');
    },
    productVariant: (text, row) => {
      const sku = row.sku?.[0]?.text || row.skuBackup?.[0]?.text;
      return cleanText(text, '', sku);
    },
    productName: (text, row) => {
      const brand = brandName(row?.brand?.[0]?.text.trim(), row.checkIfMobil1);
      const sku = row.sku?.[0]?.text || row.skuBackup?.[0]?.text;
      return cleanText(text, brand, sku);
    },
    sku: (text, row) => (text === 'dummy' ? row?.skuBackup?.[0]?.text : text),
    brand: (text, row) => {
      if (text === 'dummy') return row?.productName?.[0]?.text.split(' ')[0];
      return brandName(text, row.checkIfMobil1);
    },
    RRP: (text, row) => (text === 'dummy' ? row?.price?.[0]?.text : text),
    promoPrice: text => `-${text}`,
    packSize: (text, row) => {
      if (text !== 'dummy' && !isOnlyDigits(text)) return text;
      if (text !== 'dummy') {
        return text.length > 3 ? `${text} ml` : `${text} L`;
      }
      const title = row?.productName?.[0]?.text;
      const volumeRegex = /\b\d+(\.\d+)?\s*(?:quarts?|oz|gals?|ml|litre|litres|L|-\s*litre)\b/gi;
      const matches = title.match(volumeRegex);
      return matches ? matches[0] : '';
    },
    viscocity: text => text.replace('sae_grade', '').trim().replace(' ', '-'),
  };

  const mappingFct = (header, arr, row) => [...arr.map(({
    text,
    ...other
  }) => ({ text: mapping[header](text, row), ...other }))];

  data.forEach(obj => obj.group.forEach(row => Object.keys(row).forEach((header) => {
    // eslint-disable-next-line no-param-reassign
    if (mapping[header]) row[header] = mappingFct(header, row[header], row);
  })));
  return data;
};

module.exports = { cleanUp };
//
