/**
 *
 * @param {ImportIO.Group[]} data
 * @returns {ImportIO.Group[]}
 */
const cleanUp = (data) => {
  const mapping = {
    height: (text => (text.includes('x') ? text.split(' ')[2] : text.match(/\d{1,3}(,\d{3})*(\.\d+)?/)?.[0])),
    width: (text => (text.includes('x') ? text.split(' ')[0] : text.match(/\d{1,3}(,\d{3})*(\.\d+)?/)?.[0])),
    depth: (text => (text.includes('x') ? text.split(' ')[4] : text.match(/\d{1,3}(,\d{3})*(\.\d+)?/)?.[0])),
    weight_raw: (text => (text.match(/\d{1,3}(,\d{3})*(\.\d+)?/)?.[0])),
    // product_variations: (text => (`https://www.decodom.sk${text}`)),
    offer_price: (text => (text.replace(/[^\d,.]/g, '').replace(',', '.'))),
    original_price: (text => (text.replace(/[^\d,.]/g, '').replace(',', '.'))),
    materials: (text => (text.includes(':') ? text.split(':')[1] : text)),
    // main_image: (text => (`https://www.decodom.sk${text}`)),
    // alternative_images: (text => (`https://www.decodom.sk${text}`)),
  };

  const mappingFct = (header, arr, row) => arr.map(({ text, ...other }) => ({ text: mapping[header](text, row), ...other }));

  data.forEach(obj => obj.group.forEach(row => Object.keys(row).forEach((header) => {
    // eslint-disable-next-line no-param-reassign
    if (mapping[header]) row[header] = mappingFct(header, row[header], row);
  })));

  return data;
};

module.exports = { cleanUp };
