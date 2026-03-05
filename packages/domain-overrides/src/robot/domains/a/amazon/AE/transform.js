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
  };
  const dimensionsUnitHash = {
    centimetres: 'cm',
    centimeters: 'cm',
    metres: 'm',
    millimeters: 'mm',
    millimetres: 'mm',
    inches: 'inches',
    cm: 'cm',
    mm: 'mm',
    in: 'in',
  };
  const weightHash = {
    pounds: 'lbs',
    grams: 'g',
    kilograms: 'kg',
    ounces: 'oz',
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

  const mapping = {
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

      row.dimensions = null;
      row.product_dimensions = null;

      return text || 'Title not available';
    },
    product_vars: (text, row) => {
      let baseUrl = '';
      let prodVars = [];
      if (row.link) {
        baseUrl = row.link?.[0]?.text.split('/dp/')[0];
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
    listing_id: (text, row) => (row.qid ? `${text}/${row.qid?.[0]?.text}` : text),
    stock_availability: (text) => {
      const statuses = ['Add to Cart', 'Add to Basket', 'In stock'];
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
