/* eslint-disable no-param-reassign */

/**
 *
 * @param {ImportIO.Group[]} data
 * @returns {ImportIO.Group[]}
 */
const cleanUp = (data) => {
  // regex pattern from Ikea Schema, with 'cms' added
  const unitRegex = /(?<unit>(mm|cm|cms|m|in|ft|ft'in))$/;
  // const weightUnitRegex = /(?<unit>(kg|g|lbs|oz|m[lL]|L|c[lL]))$/;
  const lastNumberRegex = /(?<lastNumber>\d+(?:[.,]\d+)?)(?!.*\d+(?:[.,]\d+)?)/;
  // const firstNumberRegex = /(?<firstNumber>\d+(?:[.,]\d+)?).*/;
  const splitOnXOrStarInTextRegex = /(?<=\d)(?:\s*(?:x|\*)\s*)/;

  const heightFromDescriptionRegex = /(?<height>\d+(?:[.,]\d+)?)\s*cm\s*de\s*haut/im;
  const heightFromDescriptionRegexB = /Hauteur\s*(du produit)?\s*:?\s*(environ)?\s*(?<height>\d+(?:[.,]\d+)?)/im;

  const widthFromDescriptionRegex = /(?<width>\d+(?:[.,]\d+)?)\s*cm\s*de\s*large/im;
  const widthFromDescriptionRegexB = /Large\s*:?\s*(environ)?\s*(?<width>\d+(?:[.,]\d+)?)/im;

  // const depthFromDescriptionRegex = /(?<width>\d+(?:[.,]\d+)?)\s*cm\s*de\s*profondeur/im;
  // const depthFromDescriptionRegexB = /Profondeur\s*:?\s*(environ)?\s*(?<width>\d+(?:[.,]\d+)?)/im;

  const weightFromDescriptionRegex = /(?<weight>\d+(?:[.,]\d+)?)\s*kg\s*de\s*poids/im;
  const weightFromDescriptionRegexB = /Poids\s*(net)?\s*:?\s*(environ)?\s*(?<weight>\d+(?:[.,]\d+)?)/im;

  const lengthFromDescriptionRegex = /Longueur\s*(totale)?\s*:?\s*(environ)?\s*(?<length>\d+(?:[.,]\d+)?)/im;

  // [A-Za-zÀ-ÿ] captures french accent characters
  const materialsFromDescriptionRegex = /((Mati(è|e)res?|Mat(é|e)riaux)\s*:\s*)(?<materials>.*?)(\s*[A-Za-zÀ-ÿ]+\s*:|$|[^\w\sÀ-ÿ,/])/im;
  const colourFromDescriptionRegex = /([Cc]ouleur\s*:\s*)(?<colour>[^\d]*?)((?![a-z])[A-Z]|\s*[A-Za-zÀ-ÿ]+\s*:|$|[^\wÀ-ÿ\s,])/m;

  const dimensionsInDescriptionRegex = /Dimension[\w ]*:\s\s*(?<height>\d+(?:[.,]\d+)?)\s*[*x]\s*(?<width>\d+(?:[.,]\d+)?)\s*([*x]\s*(?<length>\d+(?:[.,]\d+)?))?/im;

  const setMissingField = (value, field, row) => {
    // console.log('-----setMissingField------');
    // console.log(`field: ${field}`);
    // console.log(`value: ${value}`);
    if (value && !row[field]) {
      row[field] = [{ text: value }];
      // console.log('field updated');
    }
  };
  const getDataFromDescription = (text, row) => {
    const height = text?.match(heightFromDescriptionRegex)?.groups.height
      ?? text?.match(heightFromDescriptionRegexB)?.groups.height
      ?? text?.match(dimensionsInDescriptionRegex)?.groups.height;
    const width = text?.match(widthFromDescriptionRegex)?.groups.width
      ?? text?.match(widthFromDescriptionRegexB)?.groups.width
      ?? text?.match(dimensionsInDescriptionRegex)?.groups.width;
    // const depth = text?.match(depthFromDescriptionRegex)?.groups.depth
    //   ?? text?.match(depthFromDescriptionRegexB)?.groups.depth
    //   ?? text?.match(dimensionsInDescriptionRegex)?.groups.depth;
    const length = text?.match(lengthFromDescriptionRegex)?.groups.length;

    const weight = text?.match(weightFromDescriptionRegex)?.groups.weight
      ?? text?.match(weightFromDescriptionRegexB)?.groups.weight;

    const materials = text?.match(materialsFromDescriptionRegex)?.groups.materials;
    const colour = text?.match(colourFromDescriptionRegex)?.groups.colour;

    setMissingField(height, 'height', row);
    setMissingField(width, 'width', row);
    setMissingField(weight, 'weight', row);
    setMissingField(length, 'length', row);
    setMissingField(materials, 'materials', row);
    setMissingField(colour, 'colour', row);
  };

  const getDimensionsUnit = (text) => {
    text = text?.match(unitRegex)?.groups.dimensions_unit ?? 'cm';
    return text.replace('cms', 'cm');
  };

  const dimension3D = (text, row) => {
    // Dimensions (DxWDxH in cm) = 19 x 21 x 62cm
    // split by 'x' surrounded by numbers (and optional whitespaces) to avoid issues when surrounding text contains 'x' in words
    const dimArray = text.split(splitOnXOrStarInTextRegex).map(str => str.match(lastNumberRegex)?.groups.lastNumber);

    ['length', 'width', 'height'].map((field, i) => setMissingField(dimArray[i], field, row));
    setMissingField(getDimensionsUnit(text), 'dimensions_unit', row);

    return text;
  };

  const mapping = {
    materialsFallback: (text, row) => {
      // console.log('-----Transform materialsFallback-----');
      setMissingField(text, 'materials', row);
    },
    materialsComposition: (text, row) => {
      // console.log('-----Transform materialsComposition-----');
      setMissingField(text, 'materials', row);
    },
    materialsCompositionFallback: (text, row) => {
      // console.log('-----Transform materialsComposition-----');
      setMissingField(text, 'materials', row);
    },
    materialsFromBulletPoints: (text, row) => {
      // console.log('-----Transform materialsComposition-----');
      // remove field label (old skin)
      text = text?.replace(/(Mat(è|e)riaux|Mati(è|e)res|Mati(è|e)re)\s*:?\s*/gi, '');
      setMissingField(text, 'materials', row);
    },
    dimensionsAttribute: (text, row) => {
      // console.log('-----Transform dimensionsAttribute-----');
      // console.log(text);

      dimension3D(text, row);

      const length = text?.match(lengthFromDescriptionRegex)?.groups.length;
      setMissingField(length, 'length', row);

      return `Transform executed on: ${text}`;
    },
    dimensionsAttributeFallback: (text, row) => {
      // console.log('-----Transform dimensionsAttributeFallback-----');
      // console.log(text);

      dimension3D(text, row);

      return `Transform executed on: ${text}`;
    },
    dimensionFromTitle: (text, row) => {
      // console.log('-----Transform dimensionFromTitle-----');
      // console.log(text);

      dimension3D(text, row);

      return `Transform executed on: ${text}`;
    },
    dimensionsNameAttribute: (text, row) => {
      // console.log('-----Transform dimensionsNameAttribute-----');
      // console.log(text);

      dimension3D(text, row);

      return `Transform executed on: ${text}`;
    },
    dimensionsInDescription: (text, row) => {
      // console.log('-----Transform dimensionsInDescription-----');
      // console.log(text);

      dimension3D(text, row);

      return `Transform executed on: ${text}`;
    },

    dataFromDescriptionA: (text, row) => {
      // console.log('-----Transform dataFromDescriptionA-----');
      // console.log(text);

      getDataFromDescription(text, row);

      return `Transform executed on: ${text}`;
    },
    dataFromDescriptionB: (text, row) => {
      // console.log('-----Transform dataFromDescriptionB-----');
      // console.log(text);

      getDataFromDescription(text, row);

      return `Transform executed on: ${text}`;
    },
    dataFromDescriptionC: (text, row) => {
      // console.log('-----Transform dataFromDescriptionC-----');
      // console.log(text);

      getDataFromDescription(text, row);

      return `Transform executed on: ${text}`;
    },
  };

  const mappingFct = (header, arr, row) => arr.map(({ text, ...other }) => ({ text: mapping[header](text, row), ...other }));

  data.forEach(obj => obj.group.forEach((row) => {
    Object.keys(row).forEach((header) => {
      // eslint-disable-next-line no-param-reassign
      if (mapping[header]) row[header] = mappingFct(header, row[header], row);
    });
  }));

  return data;
};

module.exports = { cleanUp };
