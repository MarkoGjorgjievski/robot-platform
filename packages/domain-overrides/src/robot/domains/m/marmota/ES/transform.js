/**
 *
 * @param {ImportIO.Group[]} data
 * @returns {ImportIO.Group[]}
 */
const cleanUp = (data) => {
  const mapping = {
    // eslint-disable-next-line no-unsafe-optional-chaining
    product_variations: (text, row) => row.product_variations_link?.[0]?.text + text,
    alternative_images: text => text.substring(2),
    main_image: text => text.substring(2),
    pack_size: text => (text === 0 ? '1' : text),
    platform_category: text => text.split('.')[1],
    offer_price: text => text.replace(/[^0-9.,]/g, '').replace(/,/g, '.'),
    original_price: text => text.replace('€', '').replace(',', '.'),
    weight_raw: text => text.replace(',', '.'),
    width: (text, row) => {
      if (text === 'dummy') {
        const regex = /\d+/g;
        const measurementsArray = row.measurements?.[0]?.text.match(regex);
        if (measurementsArray) {
          console.log(measurementsArray, 'width array', row.measurements?.[0]?.text);
          console.log(measurementsArray.width, 'width');
          return measurementsArray.width;
        }
        return null;
      }
      const matches = text?.match(/\d+/g);
      return matches ? matches[1] : text;
    },
    length: (text, row) => {
      if (text === 'dummy') {
        const regex = /\d+/g;
        const measurementsArray = row.measurements?.[0]?.text.match(regex);
        if (measurementsArray) {
          console.log(measurementsArray, 'array in length');
          console.log(measurementsArray.length, 'length');
          return measurementsArray.length;
        }
        return null;
      }
      const matches = text?.match(/\d+/g);
      return matches ? matches[0] : text;
    },
    height: (text, row) => {
      if (text === 'dummy') {
        const regex = /\d+/g;
        const measurementsArray = row.measurements?.[0]?.text.match(regex);
        if (measurementsArray) {
          return measurementsArray.height;
        }
        return null;
      }
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
