// const transform = (data) => {
//   data.forEach((el) => {
//     el.group.forEach((row) => {
//       console.log(row.specifications);
//       if (row?.stock_availability[0].text === 'I lager') {
//         row.stock_availability[0].text = 'yes';
//       } else {
//         row.stock_availability[0].text = 'no';
//       }
//       if (row.specifications) {
//         const linesOfArray = row?.specifications[0].text.split('\n');
//         const lines = linesOfArray.filter(el => el !== ' ');
//         const regex = /\b\d*\.\d+\b|\b\d+\b/;
//         const extractedValues = {
//           height: null,
//           width: null,
//           length: null,
//           weight: null,
//         };

//         let currentProperty = '';
//         let matches = [];
//         lines.forEach((line, index) => {
//           if (line.toLowerCase().includes('färg')) {
//             row.colour[0].text = lines[++index];
//           }

//           if (line.includes('mm')) {
//             const numbers = line.match(/\b\d+\b/g);
//             if (numbers) {
//               const formattedNumbers = numbers.map(el => parseFloat(el) / 10);
//               extractedValues.width = `${formattedNumbers[0]}`;
//               extractedValues.length = `${formattedNumbers[1]}`;
//               extractedValues.height = `${formattedNumbers[2]}`;
//             }
//           }

//           if (line.includes('kg')) {
//             const value = line.match(/\b\d*\,\d+\b|\b\d+\b/) || line.match(/\b\d*\.\d+\b|\b\d+\b/);
//             if (value) {
//               extractedValues.weight = value[0];
//             }
//           }

//           if (line.toLowerCase().includes('höjd') && line.length < 10) {
//             currentProperty = 'height';
//             matches = lines[++index].match(regex);
//           }

//           if (line.toLowerCase().includes('djup') && line.length < 10) {
//             currentProperty = 'length';
//             matches = lines[++index].match(regex);
//           }

//           if (line.toLowerCase().includes('bredd') && line.length < 10) {
//             currentProperty = 'width';
//             matches = lines[++index].match(regex);
//           }

//           if (line.toLowerCase().includes('vikt') && line.length < 10) {
//             currentProperty = 'weight';
//             if (index < lines.length - 1) {
//               matches = lines[++index].match(regex);
//             } else {
//               matches = lines[index].match(regex);
//             }
//           }

//           if (line.includes('gram') && line.length < 10) {
//             const value = line.match(/\b\d*\,\d+\b|\b\d+\b/);
//             extractedValues.weight = `${parseFloat(value[0]) / 1000}`;
//           }

//           if (currentProperty && matches && Array.isArray(matches) && matches.length > 0) {
//             extractedValues[currentProperty] = matches[0];
//           }
//         });
//         row.height[0].text = extractedValues?.height;
//         row.length[0].text = extractedValues?.length;
//         row.width[0].text = extractedValues?.width;
//         row.weight[0].text = extractedValues?.weight;
//       }
//     });
//   });
//   return data;
// };

// module.exports = { transform };

/**
 *
 * @param {ImportIO.Group[]} data
 * @returns {ImportIO.Group[]}
 */

const cleanUp = (data) => {
  const extractFromDimensions = (text, row, capturingGroup) => {
    const dimensionRegex = /(\d+([.]\d+)?)[^.\d]+(\d+([.]\d+)?)?[^.\d]+(\d+([.]\d+)?)?/;
    if (text === 'null') {
      const dimensionsRaw = row.dimensions_raw?.[0]?.text;
      if (dimensionsRaw !== undefined) {
        const match = dimensionsRaw.match(dimensionRegex)?.[capturingGroup];
        return match || null;
      }
      return null;
    }
    return text;
  };
  const mapping = {
    average_rating: text => (text.replace(',', '.')),
    original_price: (text, row) => {
      if (text === 'null') {
        if (row.offer_price?.[0].text !== undefined) { // if offer price exists and this wasn't found
          return null; // this should be empty
        }
        return '0'; // if product has no price - return 0
      }
      return text.replace(' ', ''); // remove spaces inside numbers
    },
    offer_price: text => (text.replace(' ', '')),
    width: (text, row) => extractFromDimensions(text, row, 1),
    length: (text, row) => extractFromDimensions(text, row, 3),
    height: (text, row) => extractFromDimensions(text, row, 5),
  };

  const mappingFct = (header, arr, row) => [...arr.map(({ text, ...other }) => ({ text: mapping[header](text, row), ...other }))];

  data.forEach(obj => obj.group.forEach(row => Object.keys(row).forEach((header) => {
    // eslint-disable-next-line no-param-reassign
    if (mapping[header]) row[header] = mappingFct(header, row[header], row);
  })));
  return data;
};

module.exports = { cleanUp };
