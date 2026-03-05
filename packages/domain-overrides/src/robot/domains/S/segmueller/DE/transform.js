/* eslint-disable array-callback-return */
/* eslint-disable no-param-reassign */
/**
 *
 * @param {ImportIO.Group[]} data
 * @returns {ImportIO.Group[]}
 */
//
const cleanUp = (data) => {
  const combineArrays = (arrayOfArrays, baseURl) => {
    if (arrayOfArrays.length === 0) {
      return [];
    }

    let output = [`${baseURl}`];

    arrayOfArrays.map((array) => {
      const newCombination = [];
      array.map((productsVariation) => {
        output.map((alreadyDone) => {
          newCombination.push(alreadyDone + productsVariation.name + productsVariation.value);
        });
      });
      output = newCombination;
    });

    const productVariations = [];

    output.forEach((variationUrl) => {
      productVariations.push({ text: new URL(variationUrl) });
      // productVariations.push({ text: variationUrl });
    });

    return productVariations;
  };

  function removeDuplicates(arrayWithDupl) {
    const unique = [];
    const uniqueArray = [];
    arrayWithDupl.forEach((element) => {
      if (!unique.includes(element.text)) unique.push(element.text);
    });

    unique.forEach((variationUrl) => {
      uniqueArray.push({ text: variationUrl });
    });

    return uniqueArray;
  }

  const mapping = {
    // eslint-disable-next-line sonarjs/cognitive-complexity
    productDetailsDimensions: (text, row) => {
      const textWithDots = text.replace(/,/g, '.');
      // dimension
      const { allDimensions } = row;
      row.dimensions_unit = [{ text: 'cm' }];
      if (!allDimensions || !allDimensions[0].text.match(/\d/g)) {
        const dimensionXSpace = textWithDots.match(/\d\S*(?: x )\d\S*(?: x )\d\S*/g);
        const dimensionXX = textWithDots.match(/\d\S*(?:x)\d\S*(?:x)\d\S*(?=cm)/g);
        const dimensionXCm = textWithDots.match(/\d\S*(?:x)\d\S*/g);
        const dimensiomCm = textWithDots.match(/\d\S*(?=cm)/g);
        const productMeasurement = textWithDots.match(/(?<=Produktabmessungen)(.*\n)+/g);

        if (productMeasurement && productMeasurement[0].includes('Gesamtbreite') && productMeasurement[0].includes('Gesamthöhe') && productMeasurement[0].includes('Gesamttiefe')) {
          row.height = [{ text: `${Number(productMeasurement[0].match(/(?<=Gesamthöhe)(.*)/g)[0].replace(/cm/g, ' ').match(/\d\S*/g)[0])}` }];
          row.width = [{ text: `${Number(productMeasurement[0].match(/(?<=Gesamtbreite)(.*)/g)[0].replace(/cm/g, ' ').match(/\d\S*/g)[0])}` }];
          row.depth = [{ text: `${Number(productMeasurement[0].match(/(?<=Gesamttiefe)(.*)/g)[0].replace(/cm/g, ' ').match(/\d\S*/g)[0])}` }];
          return text;
        }

        if (textWithDots.includes('Gesamtbreite') && textWithDots.includes('Gesamthöhe') && textWithDots.includes('Gesamttiefe')) {
          row.height = [{ text: `${Number(textWithDots.match(/(?<=Gesamthöhe)(.*)/g)[0].replace(/cm/g, ' ').match(/\d\S*/g)[0])}` }];
          row.width = [{ text: `${Number(textWithDots.match(/(?<=Gesamtbreite)(.*)/g)[0].replace(/cm/g, ' ').match(/\d\S*/g)[0])}` }];
          row.depth = [{ text: `${Number(textWithDots.match(/(?<=Gesamttiefe)(.*)/g)[0].replace(/cm/g, ' ').match(/\d\S*/g)[0])}` }];
          return text;
        }

        if (productMeasurement && productMeasurement[0].includes('Sitzbreite') && productMeasurement[0].includes('Sitzhöhe') && productMeasurement[0].includes('Sitztiefe')) {
          row.height = [{ text: `${Number(productMeasurement[0].match(/(?<=Sitzhöhe)(.*)/g)[0].replace(/cm/g, ' ').match(/\d\S*/g)[0])}` }];
          row.width = [{ text: `${Number(productMeasurement[0].match(/(?<=Sitzbreite)(.*)/g)[0].replace(/cm/g, ' ').match(/\d\S*/g)[0])}` }];
          row.depth = [{ text: `${Number(productMeasurement[0].match(/(?<=Sitztiefe)(.*)/g)[0].replace(/cm/g, ' ').match(/\d\S*/g)[0])}` }];
          return text;
        }

        if (textWithDots.includes('Sitzbreite') && textWithDots.includes('Sitzhöhe') && textWithDots.includes('Sitztiefe')) {
          row.height = [{ text: `${Number(textWithDots.match(/(?<=Sitzhöhe)(.*)/g)[0].replace(/cm/g, ' ').match(/\d\S*/g)[0])}` }];
          row.width = [{ text: `${Number(textWithDots.match(/(?<=Sitzbreite)(.*)/g)[0].replace(/cm/g, ' ').match(/\d\S*/g)[0])}` }];
          row.depth = [{ text: `${Number(textWithDots.match(/(?<=Sitztiefe)(.*)/g)[0].replace(/cm/g, ' ').match(/\d\S*/g)[0])}` }];
          return text;
        }

        if (dimensionXSpace) {
          row.height = [{ text: `${Number(dimensionXSpace[0].replace(/x/g, ' ').match(/\d\S*(?:)/g)[1])}` }];
          row.width = [{ text: `${Number(dimensionXSpace[0].replace(/x/g, ' ').match(/\d\S*(?:)/g)[0])}` }];
          row.length = [{ text: `${Number(dimensionXSpace[0].replace(/x/g, ' ').match(/\d\S*(?:)/g)[2])}` }];
          return text;
        }
        if (dimensionXX) {
          row.height = [{ text: `${Number(dimensionXX[0].replace(/x/g, ' ').match(/\d\S*(?:)/g)[1])}` }];
          row.width = [{ text: `${Number(dimensionXX[0].replace(/x/g, ' ').match(/\d\S*(?:)/g)[0])}` }];
          row.length = [{ text: `${Number(dimensionXX[0].replace(/x/g, ' ').match(/\d\S*(?:)/g)[2])}` }];
          return text;
        }

        if (dimensionXCm) {
          row.height = [{ text: `${Number(dimensionXCm[0].replace(/[a-zA-Z]/g, ' ').match(/\d\S*(?:)/g)[1])}` }];
          row.width = [{ text: `${Number(dimensionXCm[0].replace(/[a-zA-Z]/g, ' ').match(/\d\S*(?:)/g)[0])}` }];
          row.length = [{ text: `${Number(dimensionXCm[0].replace(/[a-zA-Z]/g, ' ').match(/\d\S*(?:)/g)[0])}` }];
          return text;
        }

        if (dimensiomCm) {
          row.height = [{ text: `${Number(dimensiomCm[0].replace(/x/g, ' ').match(/\d\S*(?:)/g)[0])}` }];
          row.width = [{ text: `${Number(dimensiomCm[0].replace(/x/g, ' ').match(/\d\S*(?:)/g)[0])}` }];
          row.length = [{ text: `${Number(dimensiomCm[0].replace(/x/g, ' ').match(/\d\S*(?:)/g)[0])}` }];
          return text;
        }

        return text;
      }
      const allDimensionsDot = allDimensions[0].text.replace(/,/g, '.');

      if (allDimensionsDot.includes('Durchmesser') && allDimensionsDot.includes('Höhe')) {
        row.height = [{ text: `${Number(allDimensionsDot.match(/(?<=Höhe)(.*?)(?=cm)/g)[0].match(/\d\S*/g)[0])}` }];
        row.diameter = [{ text: `${Number(allDimensionsDot.match(/(?<=Durchmesser)(.*?)(?=cm)/g)[0].match(/\d\S*/g)[0])}` }];
        return text;
      }

      if (allDimensionsDot.includes('Tiefe') && allDimensionsDot.includes('Breite') && allDimensionsDot.includes('Höhe')) {
        row.height = [{ text: `${Number(allDimensionsDot.match(/(?<=Höhe)(.*?)(?=cm)/g)[0].match(/\d\S*/g)[0])}` }];
        row.width = [{ text: `${Number(allDimensionsDot.match(/(?<=Breite)(.*?)(?=cm)/g)[0].match(/\d\S*/g)[0])}` }];
        row.depth = [{ text: `${Number(allDimensionsDot.match(/(?<=Tiefe)(.*?)(?=cm)/g)[0].match(/\d\S*/g)[0])}` }];
        return text;
      }

      if (allDimensionsDot.includes('Länge') && allDimensionsDot.includes('Breite') && allDimensionsDot.includes('Höhe')) {
        row.height = [{ text: `${Number(allDimensionsDot.match(/(?<=Höhe)(.*?)(?=cm)/g)[0].match(/\d\S*/g)[0])}` }];
        row.width = [{ text: `${Number(allDimensionsDot.match(/(?<=Breite)(.*?)(?=cm)/g)[0].match(/\d\S*/g)[0])}` }];
        row.length = [{ text: `${Number(allDimensionsDot.match(/(?<=Länge)(.*?)(?=cm)/g)[0].match(/\d\S*/g)[0])}` }];
        return text;
      }

      if (allDimensionsDot.includes('Tiefe') && allDimensionsDot.includes('Breite')) {
        if (textWithDots.includes('Kopfteilhöhe')) {
          row.height = [{ text: `${Number(textWithDots.match(/(?<=Kopfteilhöhe)(.*)(?=cm)/g)[0].match(/\d\S*/g)[0])}` }];
        }
        row.width = [{ text: `${Number(allDimensionsDot.match(/(?<=Breite)(.*?)(?=cm)/g)[0].match(/\d\S*/g)[0])}` }];
        row.depth = [{ text: `${Number(allDimensionsDot.match(/(?<=Tiefe)(.*?)(?=cm)/g)[0].match(/\d\S*/g)[0])}` }];
        return text;
      }

      if (allDimensionsDot.includes('Höhe') && allDimensionsDot.includes('Breite')) {
        row.height = [{ text: `${Number(allDimensionsDot.match(/(?<=Höhe)(.*?)(?=cm)/g)[0].match(/\d\S*/g)[0])}` }];
        row.width = [{ text: `${Number(allDimensionsDot.match(/(?<=Breite)(.*?)(?=cm)/g)[0].match(/\d\S*/g)[0])}` }];
        return text;
      }

      if (allDimensionsDot.includes('Breite')) {
        row.width = [{ text: `${Number(allDimensionsDot.match(/(?<=Breite)(.*?)(?=cm)/g)[0].match(/\d\S*/g)[0])}` }];
        return text;
      }

      if (allDimensionsDot.includes('Durchmesser')) {
        row.diameter = [{ text: `${Number(allDimensionsDot.match(/(?<=Durchmesser)(.*?)(?=cm)/g)[0].match(/\d\S*/g)[0])}` }];
        return text;
      }

      if (allDimensionsDot.includes('Länge')) {
        row.length = [{ text: `${Number(allDimensionsDot.match(/(?<=Länge)(.*?)(?=cm)/g)[0].match(/\d\S*/g)[0])}` }];
        return text;
      }

      if (allDimensionsDot.includes('Höhe')) {
        row.height = [{ text: `${Number(allDimensionsDot.match(/(?<=Höhe)(.*?)(?=cm)/g)[0].match(/\d\S*/g)[0])}` }];
        return text;
      }

      if (allDimensionsDot.match(/\d*\sx\s\d*/g)) {
        const digitWithComma = allDimensionsDot.match(/\d\S*/g);
        const headboard = textWithDots.match(/(?<=Kopfteilhöhe)(.*)(?=cm)/g);
        const heightHeadboard = textWithDots.match(/(?<=Höhe Kopfteil)(.*)(?=cm)/g);
        const totalHeight = textWithDots.match(/(?<=Gesamthöhe)(.*)(?=cm)/g);
        const bht = textWithDots.match(/(?<=B\/H\/T)(.*)/g);
        if (headboard) {
          row.height = [{ text: `${Number(headboard[0].replace(/[a-z]]/g, ' ').match(/\d\S*/g)[0])}` }];
        }

        if (heightHeadboard) {
          row.height = [{ text: `${Number(heightHeadboard[0].replace(/[a-z]]/g, ' ').match(/\d\S*/g)[0])}` }];
        }

        if (totalHeight) {
          row.height = [{ text: `${Number(totalHeight[0].replace(/[a-z]]/g, ' ').match(/\d\S*/g)[0])}` }];
        }

        if (bht) {
          row.height = [{ text: `${Number(bht[0].replace(/[a-z]]/g, ' ').match(/\d\S*(?:)/g)[1])}` }];
        }

        if (digitWithComma) {
          row.width = [{ text: `${Number(digitWithComma[0])}` }];
          row.length = [{ text: `${Number(digitWithComma[1])}` }];
        } else {
          row.width = [{ text: `${Number(allDimensionsDot.replace(/[a-z]]/g, ' ').match(/\d*/g)[0])}` }];
          row.length = [{ text: `${Number(allDimensionsDot.replace(/[a-z]]/g, ' ').match(/\d*/g)[1])}` }];
        }

        return text;
      }

      if (allDimensionsDot.match(/(?<=B\/H\/T)(.*)/g)) {
        const dimensionNumbers = textWithDots.match(/(?<=B\/H\/T)(.*)/g)[0].replace(/x/g, '').match(/\d\S*(?:)/g);

        row.height = [{ text: `${Number(dimensionNumbers[1])}` }];
        row.width = [{ text: `${Number(dimensionNumbers[0])}` }];
        row.length = [{ text: `${Number(dimensionNumbers[2])}` }];
        return text;
      }

      if (allDimensionsDot.match(/\d*/g)) {
        const dimensionNumbers = allDimensionsDot.replace(/[a-zA-Z]/g, ' ').match(/\d\S*/g);
        if (dimensionNumbers.length === 1) {
          row.width = [{ text: `${Number(dimensionNumbers[0])}` }];
          return text;
        }

        row.height = [{ text: `${Number(dimensionNumbers[1])}` }];
        row.width = [{ text: `${Number(dimensionNumbers[0])}` }];
        row.length = [{ text: `${Number(dimensionNumbers[2])}` }];
        return text;
      }

      return text;
    },
    product_title: (text, row) => {
      // alternative_images
      const alternativeImages = row.alternative_images;
      if (alternativeImages) {
        row.alternative_images = removeDuplicates(alternativeImages);
      }

      // product_variations
      const { variationsValue, variationsName } = row;
      const variations = [];
      if (variationsValue && variationsName) {
        for (let x = 0; x < variationsValue.length; x += 1) {
          for (let y = 0; y < variationsName.length; y += 1) {
            if (x === y) variations.push({ name: `&${variationsName[y].text}`, value: `=${variationsValue[x].text}` });
          }
        }

        const objectResult = variations.reduce((group, product) => {
          const { name } = product;
          group[name] = group[name] ?? [];
          group[name].push(product);
          return group;
        }, {});

        const arrayResult = Object.keys(objectResult).map(key => objectResult[key]);
        const baseUrl = `${row.urlBase?.[0].text}?queryID=${row.queryID?.[0].text}`;

        const arrayOfVariationsUrl = combineArrays(arrayResult, baseUrl);

        row.product_variations = arrayOfVariationsUrl;
      }

      return text;
    },
    shippingWeight: (text, row) => {
      if (text.includes('Paketdetails')) {
        let packages = text.split('Paketdetails:').pop();
        if (text.includes('Lieferung mit Spedition')) {
          packages = packages.split('Lieferung mit Spedition')[0].replace(/\s/g, '').split('kg');
        } else if (text.includes('Lieferung per Paket')) {
          packages = packages.split('Lieferung per Paket')[0].replace(/\s/g, '').split('kg');
        }

        let packagesWeight = 0;

        packages.forEach((package) => {
          // eslint-disable-next-line no-useless-escape
          packagesWeight += Number(package.replace(/\,/g, '.').split('/').pop());
        });

        row.weight_raw = [{ text: `${packagesWeight}` }];
      }
      row.weight_unit = [{ text: 'kg' }];
    },
  };

  const mappingFct = (header, arr, row) => [...arr.map(({ text, ...other }) => ({ text: mapping[header](text, row), ...other }))];

  data.forEach((obj) => {
    obj.group.forEach(row => Object.keys(row).forEach((header) => {
      // eslint-disable-next-line no-param-reassign
      if (mapping[header]) row[header] = mappingFct(header, row[header], row);
    }));
  });
  return data;
};

module.exports = { cleanUp };
