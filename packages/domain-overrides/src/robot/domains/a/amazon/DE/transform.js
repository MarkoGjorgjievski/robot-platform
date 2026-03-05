/* eslint-disable sonarjs/no-duplicate-string */
/* eslint-disable no-irregular-whitespace */
/* eslint-disable no-param-reassign */
/**
 *
 * @param {ImportIO.Group[]} data
 * @returns {ImportIO.Group[]}
 */
const cleanUp = (data) => {
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

  const parseTitleForPackSize = (title) => {
    if (!title) return null;
    // Regex pattern for "X Piece" or "X-piece"
    const regexPiece = /\b(\d+)\s*Piece(?:s)?\b|\b(\d+)-Piece(?:s)?\b/i;
    // Regex pattern for "set of X"
    const regexSet = /\b(?:set of)\s*(\d+)\b/i;

    let match = title.match(regexPiece);
    if (match) {
      return match[1] || match[2] || null;
    }

    match = title.match(regexSet);
    if (match) {
      return match[1] || null;
    }

    return null;
  };

  const convert = value => ({ from: fromUnit => ({ to: toUnit => (+value * units[fromUnit][toUnit]) }) });

  function cleanText(text) {
    const wordsToRemove = [
      'outlet', 'hose', 'semi synthetic', 'spout', 'barrel', 'pourer', 'tap',
      'including', 'change trailer', 'change', 'service', 'white', '30M', '40M',
      'brown', 'IV', 'volvo', 'W30', '12X', 'motoröl', 'motor', 'flush', 'additive',
      'renault', 'nissan', 'and', 'extended life', 'synthetic', 'porche',
      'garden', 'tool', 'ultraclean', 'approval', 'set', 'litres', 'liters',
      'made in', 'germany', 'pack', 'of', 'mercedes', 'benz', 'opel', 'up to',
      'from', 'golf', 'hatchback', 'motorcycle', 'smooth running', 'protective', 'gloves',
      'ACEA', 'especially', 'opelgm', 'dacia sandero', 'engines', 'man', 'meredes-benz', 'time', 'wear',
      'petrol', 'for', 'with', 'without', 'turbocharging', 'oils', 'cars', 'fully', 'pump', 'nozzle', 'car',
      'luxury', 'drive', 'part', 'compatible',
    ];

    const patterns = [
      /\b\d{1,2}W[-/]?\d{0,2}\b/g,
      /\b\d+\s?[xX]\b/g,
      /\b\d+\s?(L|litres?|liters?)\b/gi,
      /\bSAE\s*\d*\b/gi,
      /\bengine\b/gi,
      /\boil\b/gi,
      /\bsynthetic\b/gi,
      /\bfuel\b/gi,
      /\ball\b/gi,
      /\btypes\b/gi,
      /\bprotection\b/gi,
      /(?<![\w-])\d+(?![\w-])/g,
    ];

    const combinedRegex = new RegExp(patterns.map(p => p.source).join('|'), 'gi');
    const wordRegex = new RegExp(`\\b(${wordsToRemove.join('|')})\\b`, 'gi');

    return (text || '')
      .replace(wordRegex, '')
      .replace(combinedRegex, '')
      .replace(/[^a-zA-Z0-9  -]/g, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }

  const matchKnownBrand = (text) => {
    const knownBrands = ['MAGNATEC', 'CAR1', 'TOP TEC', 'MOBIL 1'];
    return knownBrands.find(brand => text.toUpperCase().includes(brand)) || null;
  };

  const matchKnownMasterBrand = (text) => {
    const knownBrands = ['MANNOL', 'CASTROL', 'MOBIL', 'LIQUI MOLY'];
    return knownBrands.find(brand => text.toUpperCase().includes(brand)) || null;
  };

  const cleanMasterBrand = text => text.replace('Bundle', '').replace('bundle', '').replace('BUNDLE', '');

  const mapping = {
    productURL: (text, row) => (text === 'dummy' ? row?.productURLBackup?.[0]?.text : text),
    viscosity: (text, row) => (text === 'dummy' ? row?.viscosityBackup?.[0]?.text : text),
    multipackQuantity: text => text.split('x')[0],
    quantity: text => text.split('x')[0],
    brand: (text, row) => {
      const masterBrandData = matchKnownMasterBrand(text) || cleanMasterBrand(row?.masterBrand?.[0].text.toUpperCase().trim() || '');
      const matchedBrand = matchKnownBrand(text);
      const cleanedText = cleanText(text) || '';
      if (matchedBrand) return matchedBrand;
      return cleanedText.toUpperCase().replace(masterBrandData, '');
    },
    brandVariant: (text, row) => {
      const masterBrandData = matchKnownMasterBrand(text) || cleanMasterBrand(row?.masterBrand?.[0].text.toUpperCase().trim() || '');
      const matchedBrand = matchKnownBrand(text);
      const cleanedText = cleanText(text) || '';
      if (matchedBrand) return matchedBrand;
      return cleanedText.toUpperCase().replace(masterBrandData, '');
    },
    productVariant: (text, row) => {
      const viscosityData = row?.viscosity?.[0].text === 'dummy' ? row?.viscosityBackup?.[0]?.text || '' : row?.viscosity?.[0].text;
      const masterBrandData = matchKnownMasterBrand(text) || cleanMasterBrand(row?.masterBrand?.[0].text.toUpperCase().trim() || '');
      const matchedBrand = matchKnownBrand(text);
      const cleanedText = cleanText(text) || '';
      if (matchedBrand) return `${matchedBrand} ${viscosityData}`;
      return `${cleanedText.toUpperCase().replace(masterBrandData, '')} ${viscosityData}`;
    },
    masterBrand: text => cleanMasterBrand(text),
    packSize: (text, row) => {
      if (text !== 'dummy') return text.replace(',', '.');
      return row?.packSizeBackup?.[0]?.text ? row?.packSizeBackup?.[0]?.text.replace(',', '.') : null;
    },
    packSizeUnit: (text, row) => {
      if (text !== 'dummy') return text;
      return row?.packSizeUnitBackup?.[0]?.text ? row?.packSizeUnitBackup?.[0]?.text : null;
    },
    ratingCount: text => text.replace(',', '').replace('.', ''),
    retailPrice: (text, row) => (row?.retailPriceFraction?.[0] ? `${text}${row?.retailPriceFraction?.[0].text}` : text),
    RRP_Was: text => text.replace(',', '.'),
    weight_unit: text => (text ? weightHash[text.toLowerCase()] : null),
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

      if (row.materials_dup) {
        row.materials = row.materials_dup.filter((value, index, self) => index === self.findIndex(t => (t.text.replace(/[\u00A0\u200a​\u200b​\u200e]/g, '') === value.text.replace(/[\u00A0\u200a​\u200b​\u200e]/g, ''))));
      }

      if (row.pack_size) {
        row.pack_size = [{ text: row.pack_size[0].text.replace(/[\u00A0\u200a​\u200b​\u200e]/g, '') }];
      } else {
        row.pack_size = [{ text: parseTitleForPackSize(text) || '1' }];
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
    listing_id: (text, row) => (row.qid ? `${text}/${row.qid[0]?.text}` : text),
    stock_availability: (text) => {
      const statuses = ['Add to Cart', 'Add to Basket', 'In stock', 'Añadir a la cesta', 'En stock'];
      const checkStatus = statuses.some(status => status.toLowerCase().trim() === text.toLowerCase().trim());
      return checkStatus ? 'yes' : 'no';
    },
    user_reviews: text => (text ? text.replace(/[.,]/, '') : null),
  };

  const mappingFct = (header, arr, row) => [...arr.map(({ text, ...other }) => ({ text: mapping[header](text, row), ...other }))];

  data.forEach(obj => obj.group.forEach(row => Object.keys(row).forEach((header) => {
    // eslint-disable-next-line no-param-reassign
    if (mapping[header]) row[header] = mappingFct(header, row[header], row);
  })));
  return data;
};

module.exports = { cleanUp };
