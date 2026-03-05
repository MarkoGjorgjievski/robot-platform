/* eslint-disable no-shadow */
/* eslint-disable no-param-reassign */
/* eslint-disable prefer-destructuring */
/**
 *
 * @param {ImportIO.Group[]} data
 * @returns {ImportIO.Group[]}
 */

const cleanUp = (data) => {
  const mapping = {
    productURL: text => text.replace(/-g%2Fm-/g, '-g/m-'),
    _url: text => text.replace(/-g%2Fm-/g, '-g/m-'),
    product_title: (text, row) => {
      if (!text) {
        return 'No title';
      }
      let colorId = '';
      let sizeId = '';
      const parsedText = JSON.parse(text);
      let productData = parsedText[0];

      if (row.params) {
        const params = JSON.parse(row.params[0].text);
        colorId = params.colorId;
      }

      const prodData = parsedText.find(obj => obj.offers.url.includes(`colorId=${colorId}`));
      if (prodData) {
        sizeId = prodData.offers.url.match(/sizeId=(\d+)/)[1];
        productData = prodData;
      }

      row.listing_id = [{ text: `${productData.mpn}/${colorId}` }];

      let originalPrice = productData.offers.price;

      if (row.offer_price && parseFloat(row.offer_price?.[0]?.text) > 0) {
        originalPrice = row.original_price?.[0]?.text;
      }

      let length;
      let width = row.width && row.width[0]?.text.match(/\d+,?\.?\d*/)[0];
      let depth = row.depth && row.depth[0]?.text;
      let height = row.height && row.height[0]?.text;
      let dimensionsUnit = row.width && row.width[0]?.text.match(/[a-zA-Z]+/)[0];

      const productVariations = parsedText.reduce((urls, data) => {
        const url = data.offers && data.offers.url;

        if (url && !urls.some(item => item.text === url) && url !== productData.offers.url) {
          urls.push({ text: url });
        }

        return urls;
      }, []);

      if (row.dimensions_unit) {
        const measurementsSplit = row.dimensions_unit[0]?.text.split(/[(x\sx)]+/).filter(Boolean);
        if (measurementsSplit.length === 4) {
          width = measurementsSplit[0];
          depth = measurementsSplit[1];
          height = measurementsSplit[2];
          dimensionsUnit = measurementsSplit[3];
        } else if (measurementsSplit.length === 3) {
          width = measurementsSplit[0];
          length = measurementsSplit[1];
          dimensionsUnit = measurementsSplit[2];
        }
      }

      row.product_variations = productVariations.length ? productVariations : [{}];

      let stockAvailability = 'yes';
      if (row.not_available) {
        stockAvailability = 'no';
      } else {
        stockAvailability = parsedText.map(pr => pr.offers.url
          .includes(colorId) && pr.offers.url.includes(`sizeId=${sizeId}`)
          && pr.offers.availability.split('schema.org/')[1])
          .some(av => av === 'InStock') ? 'yes' : 'no';
      }
      row.stock_availability = [{ text: stockAvailability }];

      row.description = [{ text: productData.description }];
      row.platform_category = [{ text: productData.offers.category }];
      row.colour = [{ text: productData.offers.color }];
      row.currency = [{ text: productData.offers.priceCurrency }];
      row.platform_id = [{ text: productData.brand.name }];

      row.original_price = [{ text: originalPrice }];
      row.width = [{ text: width }];
      row.length = [{ text: length }];
      row.height = [{ text: height }];
      row.depth = [{ text: depth }];
      row.dimensions_unit = [{ text: dimensionsUnit }];

      return productData.name || 'No title';
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
