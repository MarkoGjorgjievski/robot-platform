/* eslint-disable array-callback-return */
/* eslint-disable no-use-before-define */
/* eslint-disable no-param-reassign
*/
/**
 *
 * @param {ImportIO.Group[]} data
 * @returns {ImportIO.Group[]}
 */

const cleanUp = (data) => {
  const mapping = {
    diameter: (text) => {
      if (!text.includes('mm')) return parseFloat(text.replace(',', '.')).toString();
      const mmValue = parseFloat(text.replace(',', '.'));
      const cmValue = mmValue / 10;
      return cmValue.toString();
    },
    json_data: (text, row) => {
      let jsonString = text;// text.match(/JSON\.parse\('(.*?)'\)/)[1];
      jsonString = jsonString.replace(/\\"/g, '"');
      const jsonData = JSON.parse(jsonString);
      const variants = [];

      console.log('JSON DATA');
      if (!jsonData || !jsonData.page) {
        return;
      }

      jsonData.variantPropertySelectors?.data.variants.forEach((variant) => { variants.push({ text: `https://trademax.se${variant.uri}` }); });

      // For debugging:
      // row.json = [{ text: `${JSON.stringify(jsonData)}` }]

      console.log('VARIANTS');

      row.product_variations = variants;

      console.log('ARTICLE NUM');
      row.product_title = [{ text: `${jsonData.page.displayName}` }];
      row.listing_id = [{ text: `${jsonData.page.currentSku}` }];
      row.offer_price = [{ text: `${jsonData.page.price?.current?.inclVat}` }];
      row.original_price = [{ text: `${jsonData.page.price?.regular?.inclVat}` }];
      row.platform_category = [{ text: `${jsonData.page.breadcrumbs?.segments[jsonData.page.breadcrumbs.segments.length - 2].name}` }];

      console.log('DESCRIPTION');
      row.description = [{ text: `${getDescriptionFromJson(jsonData.page.description).replace(/<[^>]*>/g, '')}` }];
      row.user_reviews = [{ text: `${jsonData.page.jsonLd[0]?.aggregateRating?.reviewCount ?? '0'}` }];
      row.average_rating = [{ text: `${jsonData.page.jsonLd[0]?.aggregateRating?.ratingValue ?? '0.0'}` }];

      const product = jsonData.page.variants?.find(item => item.sku === jsonData.page.currentSku);

      // Alternative images
      // if (jsonData.page.images) {
      //   const imagesData = jsonData.page.images;
      //   const transformedUrls = imagesData.map(item => ({ text: `https://www.trademax.se${item.url}` }));
      //   row.alternative_images = transformedUrls;
      // } else {
      //   row.alternative_images[0].text = null;
      // }

      console.log('DIMENSIONS');

      const dimensions = product.specificationGroups?.find(group => group.heading === 'Storlek');
      const dimensionRegex = /(\d+)/;

      row.width = [{ text: null }];
      row.height = [{ text: null }];
      row.length = [{ text: null }];
      row.depth = [{ text: null }];

      if (dimensions) {
        dimensions.specifications
          .filter(spec => spec.label === 'Höjd'
              || spec.label === 'H'
              || spec.label === 'Bredd'
              || spec.label === 'B'
              || spec.label === 'Djup'
              || spec.label === 'D'
              || spec.label === 'Längd'
              || spec.label === 'L')
          .reduce((_, spec) => {
            // previously it was spec.value.text
            if (spec.label === 'Höjd' || spec.label === 'H') {
              row.height = [{ text: `${spec.value.links[0].displayText.match(dimensionRegex)?.[0] ?? 0}` }];
            } else if (spec.label === 'Bredd' || spec.label === 'B') {
              row.width = [{ text: `${spec.value.links[0].displayText.match(dimensionRegex)?.[0] ?? 0}` }];
            } else if (spec.label === 'Djup' || spec.label === 'D') {
              row.depth = [{ text: `${spec.value.links[0].displayText.match(dimensionRegex)?.[0] ?? 0}` }];
            } else if (spec.label === 'Längd' || spec.label === 'L') {
              row.length = [{ text: `${spec.value.links[0].displayText.match(dimensionRegex)?.[0] ?? 0}` }];
            }
          }, {});
      }

      const description = getDescriptionFromJson(jsonData.page.description);
      const diameterRegex = /diameter\s+på\s+(\d+(?:[.,]\d+)?)/;
      if (!description) {
        const diameterMatch = description.match(diameterRegex);

        if (diameterMatch) {
          const diameter = diameterMatch[1];
          row.diameter = [{ text: `${diameter}` }];
        }
      }

      console.log('AVAILABILITY');
      const stockAvailability = product.isBuyable && product.inventoryQuantity > 0;
      row.stock_availability = [{ text: `${stockAvailability}` }];
    },
  };

  const getDescriptionFromJson = function getDescriptionFromJson(json) {
    function buildHtml(element) {
      if (typeof element === 'string') {
        return element;
      }

      let html = `<${element.tagName}`;

      // Closing the opening tag
      html += '>';

      // Processing children if they exist
      if (element.children && element.children.length > 0) {
        // eslint-disable-next-line no-restricted-syntax
        for (const child of element.children) {
          html += buildHtml(child);
        }
      }

      // Closing tag
      html += `</${element.tagName}>`;

      return html;
    }

    return json.map(buildHtml).join('');
  };

  const mappingFct = (header, arr, row) => arr.map(({ text, ...other }) => ({ text: mapping[header](text, row), ...other }));

  data.forEach(obj => obj.group.forEach(row => Object.keys(row).forEach((header) => {
    // eslint-disable-next-line no-param-reassign
    if (mapping[header]) row[header] = mappingFct(header, row[header], row);
  })));

  return data;
};

module.exports = { cleanUp };
