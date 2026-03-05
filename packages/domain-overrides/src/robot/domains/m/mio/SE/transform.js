/* eslint-disable no-param-reassign */
/**
 *
 * @param {ImportIO.Group[]} data
 * @returns {ImportIO.Group[]}
 */
const cleanUp = (data) => {
  const parseDigit = (text) => {
    const onlyDecimalDigitsRegex = /(\d+,?\.?\d*)/;
    const match = text?.match(onlyDecimalDigitsRegex);
    return match?.[1].replace(',', '.') || null;
  };

  const mapping = {
    colour: (text) => {
      const json = JSON.parse(text);
      return json?.columns?.[1];
    },
    materials: (text) => {
      const json = JSON.parse(text);
      const allEntries = [];
      Object.keys(json).forEach((key) => {
        const entries = json[key];
        allEntries.push(...entries);
      });

      const entriesThatContainsMaterialInfo = allEntries.filter(entry => entry.key?.toLowerCase().includes('material'));

      const materials = entriesThatContainsMaterialInfo.map(entry => `${entry.columns[0]}: ${entry.columns[1]}`);

      return materials.join(', ');
    },

    pack_size: (text) => {
      const regex = /(\d+)-pack/;
      return text.match(regex)?.[1] || '1';
    },

    product_details: (text) => {
      const json = JSON.parse(text);
      const allEntries = [];
      Object.keys(json).forEach((key) => {
        const entries = json[key];
        allEntries.push(...entries);
      });

      const details = allEntries.map((entry) => {
        if (entry.columns.length === 2) return `${entry.columns[0]}: ${entry.columns[1]}`;
        return entry.columns.join(' ');
      });

      return details.join(', ');
    },
    dimensions_values: (text, row) => {
      const specifications = JSON.parse(text);
      const specificationCategories = Object.keys(specifications);
      const specificationItems = [];
      specificationCategories.forEach((category) => {
        const items = specifications[category];
        specificationItems.push(...items);
      });

      const findKey = (arr, key) => arr.find(item => item.key === key)?.columns[1];

      const depth = parseDigit(findKey(specificationItems, 'depth'));
      const width = parseDigit(findKey(specificationItems, 'width'));
      const length = parseDigit(findKey(specificationItems, 'length'));
      const height = parseDigit(findKey(specificationItems, 'height'));
      const diameter = parseDigit(findKey(specificationItems, 'diameter'));
      const weight = parseDigit(findKey(specificationItems, 'weight'));

      row.height = [{ text: height }];
      row.diameter = [{ text: diameter }];
      row.width = [{ text: width }];
      row.length = [{ text: length }];
      row.weight_raw = [{ text: weight }];
      row.depth = [{ text: depth }];
    },

    platform_category: (text, row) => {
      const platformCategoryFromBreadcrumbs = row.platform_category_from_breadcrumbs?.[0]?.text;
      const platformCategoryFromProductType = row.platform_category_from_product_type?.[0]?.text;

      if (platformCategoryFromProductType) return platformCategoryFromProductType;
      if (platformCategoryFromBreadcrumbs) return platformCategoryFromBreadcrumbs;
      return text;
    },

    product_variations: (text, row) => {
      const productURL = row.productURL?.[0]?.text;
      return productURL.replace(/id=[\w\d]+/, `id=${text}`);
    },

    product_title: (text) => {
      const splitted = text.split('|');
      return splitted?.[0]?.trim();
    },

    // json: (text) => {
    //   const json = JSON.parse(text);
    //   const stringify = JSON.stringify(json, null, 2);
    //   console.log(stringify);
    // },
  };

  const mappingFct = (header, arr, row) => arr.map(({ text, ...other }) => ({
    text: mapping[header](text, row),
    ...other,
  }));

  data.forEach(obj => obj.group.forEach(row => Object.keys(row).forEach((header) => {
    // eslint-disable-next-line no-param-reassign
    if (mapping[header]) row[header] = mappingFct(header, row[header], row);
  })));

  return data;
};

module.exports = { cleanUp };
