/* eslint-disable camelcase */
/* eslint-disable no-param-reassign */
/**
 *
 * @param {ImportIO.Group[]} data
 * @returns {ImportIO.Group[]}
 */
const cleanUp = (data) => {
  const mapping = {
    listing_id: (text, row) => {
      if (text !== 'dummy') return text;
      const jsonData = JSON.parse(row.product_variations_data?.[0]?.text);
      return jsonData ? jsonData.props.pageProps.catalog.product.sku : null;
    },
    offer_price: (text, row) => {
      if (!row.original_price) {
        row.original_price = [{ text }];
        return null;
      }
      return text;
    },
    size_raw: (text, row) => {
      const dimRegEx = /([\d.]+)\s*[X×x]\s*([\d.]+)(\s*[X×x]\s*([\d.]+))?/;
      const match = text.match(dimRegEx);
      if (match) {
        if (!row.width && !row.height) {
          row.width = [{ text: match?.[1] }];
          row.height = [{ text: match?.[2] }];
        }
        if (!row.length) {
          row.length = [{ text: match?.[4] || null }];
        }
      }
      return text;
    },
    product_title: (text, row) => {
      const dimRegEx = /([\d.]+)\s*[X×x]\s*([\d.]+)(\s*[X×x]\s*([\d.]+))?/;
      const match = text.match(dimRegEx);
      if (match) {
        if (!row.width && !row.height) {
          row.width = [{ text: match?.[1] }];
          row.height = [{ text: match?.[2] }];
        }
        if (!row.length) {
          row.length = [{ text: match?.[4] || null }];
        }
      }
      return text;
    },
    product_details: text => text
      .split('\n')
      .map((e, i) => ((i % 2 === 0) ? `${e}:` : `${e}\n`))
      .join(''),
    product_variations_data: (text, row) => {
      const jsonData = JSON.parse(text);
      // Create alternative images links
      const imgKeysArray = jsonData.props.pageProps.catalog.product.image_keys;

      const imagesArray = imgKeysArray.map((item) => {
        const formattedUrl = `https://f.nooncdn.com/p/${item}.jpg`;
        return { text: formattedUrl };
      });
      row.alternative_images = imagesArray;
      // Create main image link
      // row.main_image[0].text = `https://f.nooncdn.com/p/${imgKeysArray[0]}.jpg`;
      // Create variationss links
      const variationsDataArray = jsonData.props.pageProps.catalog.product.groups?.[0]?.options;
      if (variationsDataArray) {
        const variationsArray = variationsDataArray.map((item) => {
          const { offer_code, sku, url } = item;
          const formattedUrl = `https://www.noon.com/saudi-en/${url}/${sku}/p/?o=${offer_code}`;
          return { text: formattedUrl };
        });
        if (variationsArray.length > 1) {
          row.product_variations = variationsArray;
        } else {
          row.product_variations[0].text = null;
        }
      }
      row.product_variations[0].text = null;
      return text;
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
