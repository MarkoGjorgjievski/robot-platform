/**
 *
 * @param {ImportIO.Group[]} data
 * @returns {ImportIO.Group[]}
 */
const cleanUp = (data) => {
  const extractDimensions = (text, row, regex) => {
    const dimensionsRaw = row.dimensions_raw?.[0]?.text;
    if (dimensionsRaw !== undefined) {
      const matchedValue = dimensionsRaw.split(/[x,]/).filter(dim => dim.match(regex));
      // console.log('matched value:', matchedValue);
      if (matchedValue.length > 0) { // value found in 'size' takes priority over the one caught by name
        return matchedValue[0].replace(/[^\d.]/g, '');
      }
    }
    return (text !== 'null') ? text : null;
  };
  // block words which appear in product title  where colour is expected but are bed sizes
  const colourBlocklist = /Cot|Double|Single/;
  const resolveMaterials = (row) => {
    const output = { ...row, materials: [] };

    if (row.materials_raw) {
      const backupMaterials = row.materials_raw.map(m => m.text);
      backupMaterials.forEach((rawMaterial) => {
        rawMaterial.split(/ and |;/).forEach((m) => {
          output.materials.push({ text: m });
        });
      });
    }
    if (row.materials_backup) {
      const backupMaterials = row.materials_backup.map(m => m.text);
      backupMaterials.forEach((backupMaterial) => {
        backupMaterial.split(/ and |;/).forEach((m) => {
          output.materials.push({ text: m });
        });
      });
    }
    return output;
  };
  const mapping = {
    colour: text => (!text.match(colourBlocklist) ? text : null),
    original_price: (text) => {
      const pricesAttributes = JSON.parse(text);
      return pricesAttributes.was
        ? String(pricesAttributes.was)
        : String(pricesAttributes.now);
    },
    offer_price: (text) => {
      const pricesAttributes = JSON.parse(text);
      return pricesAttributes.was
        ? String(pricesAttributes.now)
        : null;
    },
    product_variations: text => (`https://www.argos.co.uk/product/${text}`),
    average_rating: text => String(Math.round((+JSON.parse(text) + Number.EPSILON) * 100) / 100),
    // pack_size: text => (+text > 0 ? text : '1'),
    height: (text, row) => extractDimensions(text, row, /[Hh]/),
    length: (text, row) => extractDimensions(text, row, /[Ll]/),
    width: (text, row) => extractDimensions(text, row, /[Ww]/),
    depth: (text, row) => extractDimensions(text, row, /[Dd]/),
    main_image: text => (`${text}.jpg`),
    // diameter: (text, row) => extractDimensions(text, row, /[Dd]iameter/),
  };

  const mappingFct = (header, arr, row) => [
    ...arr.map(({ text, ...other }) => ({
      text: mapping[header](text, row),
      ...other,
    })),
  ];

  data.forEach(obj => obj.group.forEach(row => Object.keys(row).forEach((header) => {
    // eslint-disable-next-line no-param-reassign
    if (mapping[header]) row[header] = mappingFct(header, row[header], row);
  })));
  // eslint-disable-next-line no-return-assign, no-param-reassign
  data.forEach(obj => obj.group = obj.group.map(row => resolveMaterials(row)));

  return data;
};

module.exports = { cleanUp };
