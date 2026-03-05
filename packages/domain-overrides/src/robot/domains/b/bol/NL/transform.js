/**
 *
 * @param {ImportIO.Group[]} data
 * @returns {ImportIO.Group[]}
 */
const cleanUp = (data) => {
  const mapping = {
    // productURL: text => `https://www.bol.com/${text}`,
    offer_price: (text, row) => (row.original_price_fraction?.[0]?.text.length > 1 ? `${text}.${row.original_price_fraction?.[0]?.text}` : text),
    original_price: (text, row) => (text === 'dummy' ? row.offer_price?.[0]?.text : text),
    product_variations: text => `https://www.bol.com/${text}`,
    length: (text, row) => (text === 'dummy' ? row.length_backup?.[0]?.text : text),
    materials: (text) => {
      const regex = /Materiaal:\s*(.+)/;
      const match = text.match(regex);
      return match ? match[1] : text;
    },
    height: (text, row) => ((text !== '0' && text) ? text : row.dimensions_backup?.[2]?.text),
    depth: (text, row) => {
      if (text !== '0') return text;
      if (row.dimensions_backup[0].text !== 'dummy') return row.dimensions_backup?.[0]?.text;
      return null;
    },
    price: text => text.replace(/,/, '.').replace(/\s/, '.').replace(/-/, ''),
    reseller_link: (text, row) => `https://bol.com${text}?offerUid=${row?.offerId?.[0]?.text}`,
    reseller_feedback_percent: text => text.replace(/,/, '.'),
    product_name: (text, row) => {
      if (!row.reseller_name?.[0]?.text) {
        // eslint-disable-next-line no-param-reassign
        row.reseller_name = [{ text: 'Bol' }];
        // eslint-disable-next-line no-param-reassign
        row.reseller_link = [{ text: `https://bol.com?offerUid=${row?.offerId?.[0]?.text}` }];
      }
      return text;
    },
    upc_user_input: (text, row) => {
      if (text === 'empty') return row.upc_user_input_backup?.[0]?.text ?? null;
      return text;
    },
    product_sku: (text, row) => {
      if (text === 'empty') return row.product_sku_backup?.[0]?.text ?? null;
      return text;
    },
    country: text => text?.toUpperCase(),

    // variants: text => `https://www.bol.com/nl/nl/prijsoverzicht/p/${text}?filter=new&sort=price&sortOrder=asc`,
  };

  const mappingFct = (header, arr, row) => [...arr.map(({ text, ...other }) => ({ text: mapping[header](text, row), ...other }))];

  data.forEach(obj => obj.group.forEach(row => Object.keys(row).forEach((header) => {
    // eslint-disable-next-line no-param-reassign
    if (mapping[header]) row[header] = mappingFct(header, row[header], row);
  })));
  return data;
};

module.exports = { cleanUp };
