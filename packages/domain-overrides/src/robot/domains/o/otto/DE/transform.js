/* eslint-disable prefer-destructuring */
/* eslint-disable no-param-reassign */

/**
 *
 * @param {ImportIO.Group[]} data
 * @returns {ImportIO.Group[]}
 */
//
const cleanUp = (data) => {
  const extractedValues = {
    height: [],
    width: [],
    length: [],
    weight: [],
    diameter: [],
    colour: [],
    materials: '',
    pack_size: 1,
  };
  const extractValues = (input, row, isDescription) => {
    const lines = input.split('\n');
    const regex = /(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d+)?)/g;
    lines.forEach((line, index) => {
      if (line.includes('Farbe') && line.length > 5) {
        if (isDescription) {
          extractedValues.colour = [...extractedValues.colour, line];
        } else {
          index += 1;
          extractedValues.colour = [...extractedValues.colour, lines[index]];
        }
      }

      if (line.toLowerCase().includes('höhe') && line.length > 5) {
        const matches = line.match(regex);
        if (isDescription) {
          if (matches) {
            extractedValues.height = Array.isArray(matches[0]) ? [...extractedValues.height, ...matches[0]] : [...extractedValues.height, matches[0]];
          }
        } else if (index + 1 < lines.length) {
          const linesMatches = lines[index + 1].match(regex);
          if (linesMatches) {
            extractedValues.height = Array.isArray(linesMatches[0])
              ? [...extractedValues.height, ...linesMatches[0]] : [...extractedValues.height, linesMatches[0]];
          }
        }
      }

      if (line.toLowerCase().includes('durchmesser')) {
        const newLine = line.substring(line.toLowerCase().indexOf('durchmesser') + 1);
        const matches = newLine.match(regex);
        if (isDescription) {
          if (matches) {
            extractedValues.diameter = Array.isArray(matches[0])
              ? [...extractedValues.diameter, ...matches[0]] : [...extractedValues.diameter, matches[0]];
          }
        } else if (index + 1 < lines.length) {
          const linesMatches = lines[index + 1].match(regex);
          if (linesMatches) {
            extractedValues.diameter = Array.isArray(linesMatches[0])
              ? [...extractedValues.diameter, ...linesMatches[0]] : [...extractedValues.diameter, linesMatches[0]];
          }
        }
      }

      if (line.toLowerCase().includes('material') && isDescription) {
        const newLine = line.includes(':') ? line.split(':') : line;
        if (Array.isArray(newLine)) {
          extractedValues.materials = `${newLine[0]}: ${newLine[1]}`;
        } else {
          extractedValues.materials = line;
        }
      }

      if ((line.toLowerCase().includes('tiefe') || line.toLowerCase().includes('länge')) && line.length < 25) {
        const matches = line.match(regex);
        if (isDescription) {
          if (matches) {
            extractedValues.length = Array.isArray(matches[0])
              ? [...extractedValues.length, ...matches[0]] : [...extractedValues.length, matches[0]];
          }
        } else if (index + 1 < lines.length) {
          const linesMatches = lines[index + 1].match(regex);
          if (linesMatches) {
            extractedValues.length = Array.isArray(linesMatches[0])
              ? [...extractedValues.length, ...linesMatches[0]] : [...extractedValues.length, linesMatches[0]];
          }
        }
      }

      if (line.toLowerCase().includes('breit') && line.length < 25) {
        const matches = line.match(regex);
        if (isDescription) {
          if (matches) {
            extractedValues.width = Array.isArray(matches[0]) ? [...extractedValues.width, ...matches[0]] : [...extractedValues.width, matches[0]];
          }
        } else if (index + 1 < lines.length) {
          const linesMatches = lines[index + 1].match(regex);
          if (linesMatches) {
            extractedValues.width = Array.isArray(linesMatches[0])
              ? [...extractedValues.width, ...linesMatches[0]] : [...extractedValues.width, linesMatches[0]];
          }
        }
      }

      if (line.toLowerCase().includes('gewicht') && line.length < 25) {
        const matches = line.match(regex);
        if (isDescription) {
          if (matches) {
            extractedValues.weight = Array.isArray(matches[0]) ? [...extractedValues.weight, ...matches[0]] : [...extractedValues.weight, matches[0]];
          }
        } else if (index + 1 < lines.length) {
          const linesMatches = lines[index + 1].match(regex);
          if (linesMatches) {
            extractedValues.weight = Array.isArray(linesMatches[0])
              ? [...extractedValues.weight, ...linesMatches[0]] : [...extractedValues.weight, linesMatches[0]];
          }
        }
      }

      if (line.toLowerCase().includes('anzahl teile') && (index + 1 < lines.length)) {
        const linesMatches = lines[index + 1].match(regex);
        if (linesMatches) {
          extractedValues.pack_size = linesMatches[0];
        }
      }

      if (line.toLowerCase().includes('größe und gewich')) {
        const matches = line.match(regex);
        if (matches) {
          extractedValues.length = Array.isArray(matches[0]) ? [...extractedValues.length, ...matches[0]] : [...extractedValues.length, matches[0]];
          extractedValues.weight = Array.isArray(matches[matches.length - 1])
            ? [...extractedValues.weight, ...matches[matches.length - 1]] : [...extractedValues.weight, matches[matches.length - 1]];
          if (matches.length > 2) {
            extractedValues.diameter = Array.isArray(matches[1])
              ? [...extractedValues.diameter, ...matches[1]] : [...extractedValues.diameter, matches[1]];
          }
        }
      }

      if (line.toLowerCase().includes('außenmaße:')) {
        let dimensions;
        const finalDimensions = [];
        if (line?.split(':')[1]) dimensions = line?.split(':')[1];
        if (line?.split(',')) dimensions = line?.split(',');

        if (dimensions) {
          dimensions.forEach((dimension) => {
            const localRegex = /(\d+[.,/]\d+)|\d+/g;
            const matches = dimension.match(localRegex);
            if (dimension?.split(':')[1]) dimension = dimension?.split(':')[1];
            if (matches) {
              finalDimensions.push(matches[0].includes('/') ? matches[0].split('/')[0] : matches[0]);
            }
          });
          const [width, length, height] = finalDimensions;
          if (finalDimensions) {
            extractedValues.width = Array.isArray(width) && width ? [...extractedValues.width, ...width] : [...extractedValues.width, width];
            extractedValues.length = Array.isArray(length) && length ? [...extractedValues.length, ...length] : [...extractedValues.length, length];
            extractedValues.height = Array.isArray(height) && height ? [...extractedValues.height, ...height] : [...extractedValues.height, height];
          }
        }
      }

      if (line.toLowerCase().includes('gesamt')) {
        let dimensions = [];
        if (line.includes(',')) {
          dimensions = line.split(',');
        }
        if (dimensions.length > 1) {
          dimensions.forEach((dimension) => {
            const match = dimension.match(/\d+[,.]*\d*/g);
            if (match) {
              if (dimension.toLowerCase().includes('breite')) {
                row.width = [{ text: match[0] }];
              }
              if (dimension.toLowerCase().includes('höhe')) {
                row.height = [{ text: match[0] }];
              }
              if (dimension.toLowerCase().includes('tiefe')) {
                row.length = [{ text: match[0] }];
              }
            }
          });
        }
      }
    });
  };
  const mapping = {
    height: text => (text === '-1' && extractedValues.height ? extractedValues.height?.[extractedValues.height.length - 1] : text),
    length: (text) => {
      if (text === '-1' && extractedValues.length) {
        return extractedValues.length?.[extractedValues.length.length - 1];
      }
      return text;
    },
    diameter: text => (text === '-1' && extractedValues.diameter ? extractedValues.diameter?.[extractedValues.diameter.length - 1] : text),
    width: text => (text === '-1' && extractedValues.width ? extractedValues.width?.[extractedValues.width.length - 1] : text),
    weight: text => (text === '-1' && extractedValues.weight ? extractedValues.weight?.[extractedValues.weight.length - 1] : text),
    pack_size: text => (text === '1' && extractedValues.pack_size ? extractedValues.pack_size : text),
    original_price: (text, row) => {
      if (!row.product_link && row.product_variations) {
        delete row.product_variations;
      }
      if (text && row.offer_price && text === row.offer_price[0].text && text === row.original_price[0].text) {
        delete row.offer_price;
      }
      return text;
    },
    product_link: (text, row) => {
      if (extractedValues.materials) {
        row.materials = [{ text: extractedValues.materials }];
      }
      if (row.materialsLeft && row.materialsRight && !row.materials) {
        row.materials = [...row.materialsLeft.map((element, indexEl) => ({ text: `${element.text}: ${row.materialsRight[indexEl].text}` }))];
      }
      row?.product_variations.forEach((element) => {
        element.text = `${row?.product_link?.[0]?.text}#variationId=${element.text}`;
      });
      return text;
    },
    captions: (text, row) => {
      if (text && row.product_dimensions) {
        const dimensions = row.product_dimensions?.[0]?.text.split('x');
        const [width, length, height] = dimensions;
        row.height = row.height[0] && [{ text: height.toString().trim() }];
        row.width = row.width[0] && [{ text: width.toString().trim() }];
        row.length = row.length[0] && [{ text: length.toString().trim() }];
      }
      return text;
    },
  };
  const mappingFct = (header, arr, row) => [
    ...arr.map(({ text, ...other }) => ({
      text: mapping[header](text, row),
      ...other,
    })),
  ];

  data.forEach(obj => obj.group.forEach(row => Object.keys(row).forEach((header) => {
    // eslint-disable-next-line no-param-reassign
    if (header === 'description') {
      row[header].forEach((description) => {
        extractValues(description.text, row, true);
      });
    }
    if (header === 'product_details') {
      row[header].forEach((details) => {
        extractValues(details.text, row, false);
      });
    }
    if (mapping[header]) {
      row[header] = mappingFct(header, row[header], row);
      row[header] = row[header].length && row[header]?.[0]?.text !== '-1' ? row[header] : [{}];
    }
  })));
  return data;
};

module.exports = { cleanUp };
