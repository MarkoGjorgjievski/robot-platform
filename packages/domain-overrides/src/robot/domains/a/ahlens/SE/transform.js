/**
 *
 * @param {ImportIO.Group[]} data
 * @returns {ImportIO.Group[]}
 */
const cleanUp = (data) => {
  const regex = /^(?:\d+)?(?:px|em|%|rem|cm|mm|in|pt|pc|vh|vw|vmin|vmax)$/i;
  const listingRegex = /Art\.nr\s+(.+)/;
  const genReg = value => new RegExp(`${value}\\s*:?\\s*([\\d,.]+)\\s*cm`, 'i');
  function takeDiameter(text) {
    const reg = /Diameter:?\s*(\d+([.,]\d+)?)\s*cm/;
    const match = reg.exec(text);
    if (match) {
      // Replace comma with period for standard decimal format
      return match[1].replace(',', '.');
    }
    return null;
  }
  const mapping = {
    // eslint-disable-next-line consistent-return
    listing_id: (text) => {
      if (text) {
        const match = listingRegex.exec(text);
        if (match) {
          return match[1];
        }
        return text;
      }
    },
    // eslint-disable-next-line consistent-return
    stock_availability: (text) => {
      if (text) {
        return 'yes';
      }
    },
    dimensions_unit: (text) => {
      if (regex.test(text)) {
        return regex.exec(text);
      }
      return 'cm';
    },
    variations_data: (text, row) => {
      const jsonObject = JSON.stringify(text);
      const js = JSON.parse(jsonObject);
      const removedString = js.replace('https://www.ahlens.se', '');
      const x = JSON.parse(removedString);
      const data1 = x.props.pageProps.product.options;
      const final = data1.map(el => ({ text: `https://www.ahlens.se${el.optionUrl}` }));
      if (final.length > 1) {
        // eslint-disable-next-line no-param-reassign
        row.product_variations = final;
      } else {
        // eslint-disable-next-line no-param-reassign
        row.product_variations = null;
      }
    },
    original_price: (text, row) => {
      if (text === '-') {
        return row?.offer_price?.[0]?.text;
      }
      return text;
    },
    // eslint-disable-next-line consistent-return
    height: (text) => {
      if (text) {
        // eslint-disable-next-line no-shadow
        const match = genReg('Höjd')
          .exec(text);
        if (match) {
          return match[1];
        }
        return null;
      }
    },
    // eslint-disable-next-line consistent-return
    width: (text) => {
      if (text) {
        // eslint-disable-next-line no-shadow
        const match = genReg('Bredd')
          .exec(text);
        if (match) {
          return match[1];
        }
        return null;
      }
    },
    // eslint-disable-next-line consistent-return
    length: (text) => {
      if (text) {
        // eslint-disable-next-line no-shadow
        const match = genReg('Längd')
          .exec(text);
        if (match) {
          return match[1];
        }
        return null;
      }
    },
    // eslint-disable-next-line consistent-return
    weight_raw: (text) => {
      if (text) {
        // eslint-disable-next-line no-shadow
        const match = genReg('Vikt')
          .exec(text);
        if (match) {
          return match[1];
        }
        return null;
      }
    },
    // eslint-disable-next-line consistent-return
    materials: (text) => {
      if (text) {
        return `material: ${text}`;
      }
    },
    // eslint-disable-next-line consistent-return
    diameter: (text) => {
      if (text) {
        return takeDiameter(text);
      }
    },
  };
  const mappingFct = (header, arr, row) => [...arr.map(({
    text,
    ...other
  }) => ({ text: mapping[header](text, row), ...other }))];
  data.forEach(obj => obj.group.forEach(row => Object.keys(row)
    .forEach((header) => {
      // eslint-disable-next-line no-param-reassign
      if (mapping[header]) row[header] = mappingFct(header, row[header], row);
    })));
  return data;
};

module.exports = { cleanUp };
