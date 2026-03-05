/* eslint-disable consistent-return */
/* eslint-disable array-callback-return */
/* eslint-disable no-param-reassign */
/* eslint-disable linebreak-style */
/**
 *
 * @param {ImportIO.Group[]} data
 * @returns {ImportIO.Group[]}
 */

const cleanUp = (data) => {
  const transformSingleDimension = (dimension) => {
    const unit = dimension.match(/[a-z]+/g);
    if (!unit) return dimension;
    let number = dimension.replace(/(?<=\d)(\s)(?=\d)/g, '').replace(/[a-z]/g, '').match(/\d\S*/g)[0].replace(/,/g, '.');
    switch (unit[0]) {
      case 'mm':
        number /= 10;
        break;
      case 'cm':
        break;
      case 'm':
        number *= 100;
        break;
      case 'dm':
        number *= 10;
        break;
      case 'km':
        number *= 100000;
        break;
      default:
        break;
    }
    return String(number);
  };

  const mapping = {
    product_details: text => text.replace(/\n/g, ': '),
    height: text => transformSingleDimension(text),
    depth: text => transformSingleDimension(text),
    length: text => transformSingleDimension(text),
    width: text => transformSingleDimension(text),
    diameter: text => transformSingleDimension(text),
    weight_raw: (text) => {
      const unit = text.match(/[a-z]+/g)[0];
      let number = text.match(/\d\S*/g)[0];
      switch (unit) {
        case 'g':
          number /= 1000;
          break;
        case 'kg':
          break;
        case 'dag':
          number /= 100;
          break;
        case 't':
          number *= 1000;
          break;
        default:
          break;
      }

      return number;
    },
    allDimensionKey: (text, row) => {
      const { allDimensionOverall, allDimensionKeyOverall } = row;
      let allDimensionValue;
      let dimensionOrder;

      if (allDimensionOverall && allDimensionKeyOverall) {
        allDimensionValue = allDimensionOverall?.[0].text.replace(/(?<=\d)(\s)(?=\d)/g, '').match(/\d\S*\s[a-z]+/g);
        dimensionOrder = allDimensionKeyOverall?.[0].text.match(/(?<=\()(.*)(?=\))/g)[0];
      } else {
        allDimensionValue = row.allDimension?.[0].text.replace(/(?<=\d)(\s)(?=\d)/g, '').match(/\d\S*\s[a-z]+/g) || row.allDimension?.[0].text.replace(/(?<=\d)(\s)(?=\d)/g, '').match(/.*/g);
        // eslint-disable-next-line prefer-destructuring
        dimensionOrder = text.match(/(?<=\()(.*)(?=\))/g)?.[0] || text;
      }

      if (dimensionOrder.match(/Š(\sx\s|x)V(\sx\s|x)H/g)) {
        row.width = [{ text: String(transformSingleDimension(allDimensionValue[0])) }];
        row.height = [{ text: String(transformSingleDimension(allDimensionValue[1])) }];
        row.depth = [{ text: String(transformSingleDimension(allDimensionValue[2])) }];
        return text;
      }

      if (dimensionOrder.match(/V(\sx\s|x)Š(\sx\s|x)H/g)) {
        row.height = [{ text: String(transformSingleDimension(allDimensionValue[0])) }];
        row.width = [{ text: String(transformSingleDimension(allDimensionValue[1])) }];
        row.depth = [{ text: String(transformSingleDimension(allDimensionValue[2])) }];
        return text;
      }

      if (dimensionOrder.match(/D(\sx\s|x)Š(\sx\s|x)H/g)) {
        row.length = [{ text: String(transformSingleDimension(allDimensionValue[0])) }];
        row.width = [{ text: String(transformSingleDimension(allDimensionValue[1])) }];
        row.depth = [{ text: String(transformSingleDimension(allDimensionValue[2])) }];
        return text;
      }

      if (dimensionOrder.match(/D(\sx\s|x)Š(\sx\s|x)V/g)) {
        row.length = [{ text: String(transformSingleDimension(allDimensionValue[0])) }];
        row.width = [{ text: String(transformSingleDimension(allDimensionValue[1])) }];
        row.height = [{ text: String(transformSingleDimension(allDimensionValue[2])) }];
        return text;
      }

      if (dimensionOrder.match(/D(\sx\s|x)Š/g)) {
        row.length = [{ text: String(transformSingleDimension(allDimensionValue[0])) }];
        row.width = [{ text: String(transformSingleDimension(allDimensionValue[1])) }];
        return text;
      }

      if (dimensionOrder === text && allDimensionValue[0].match(/\d\S*(\sx\s|x)\d\S*(\sx\s|x)\d\S*/g)) {
        const withoutX = allDimensionValue[0].replace(/x/g, ' ');
        const unit = withoutX.match(/[a-z]+/g);
        const dimensionvalues = withoutX.match(/\d\S*/g);

        row.length = [{ text: String(transformSingleDimension(`${dimensionvalues[0]} ${unit[0]}`)) }];
        row.width = [{ text: String(transformSingleDimension(`${dimensionvalues[1]} ${unit[0]}`)) }];
        row.height = [{ text: String(transformSingleDimension(`${dimensionvalues[2]} ${unit[0]}`)) }];
        return text;
      }

      if (dimensionOrder === text && allDimensionValue[0].match(/\d\S*(\sx\s|x)\d\S*/g)) {
        const withoutX = allDimensionValue[0].replace(/x/g, ' ');
        const unit = withoutX.match(/[a-z]+/g);
        const dimensionvalues = withoutX.match(/\d\S*/g);

        row.length = [{ text: String(transformSingleDimension(`${dimensionvalues[0]} ${unit[0]}`)) }];
        row.width = [{ text: String(transformSingleDimension(`${dimensionvalues[1]} ${unit[0]}`)) }];
        return text;
      }

      if (dimensionOrder === text) {
        row.length = [{ text: String(transformSingleDimension(allDimensionValue[0])) }];
        return text;
      }

      return text;
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
