// const transform = (data) => {
//   data.forEach((el) => {
//     el.group.forEach((row) => {
//       const lines = row?.description[0].text.split('\n').filter(el => el !== ' ');
//       let foundMatch = false;
//       lines.forEach((line, index) => {
//         if (line.toLowerCase().includes('colour') || line.toLowerCase().includes('colours') && line.length > 10) {
//           row.colour[0].text = line.substring(line.indexOf(':') + 1).trim();
//         } else if (line.toLowerCase().includes('colour') || line.toLowerCase().includes('colours') && line.length < 10) {
//           row.colour[0].text = lines[++index];
//         }

//         if ((line.toLowerCase().includes('dimensions') || line.toLowerCase().includes('size')) && !foundMatch) {
//           const nextLine = lines[++index];
//           const regEx1 = /\b(\d+(?:\.\d+)?)\b/g;
//           const regEx2 = /\d+(?:\.\d+)?/g;
//           const matches = line.match(regEx1) || (nextLine && nextLine.match(regEx1)) || line.match(regEx2) || (nextLine && nextLine.match(regEx2));
//           if (matches) {
//             const [width, length, height] = matches;
//             width ? row.width[0].text = width : row.width[0].text = null;
//             length ? row.length[0].text = length : row.length[0].text = null;
//             height ? row.height[0].text = height : row.height[0].text = null;
//             foundMatch = true;
//           }
//         }
//       });
//       if (!foundMatch) {
//         row.width[0].text = null;
//         row.height[0].text = null;
//         row.length[0].text = null;
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
  const sizeRegex = /[^\d.]*(\d+(\.?\d+)?)[^\d.]*(\d+(\.?\d+)?)?[^\d."m\n]*(\d+(\.?\d+)?)?/;
  const extractFromRawDimensions = (text, row, index) => {
    if (text === 'null') {
      if (row.sizes_raw?.[0]?.text !== undefined) {
        const match = row.sizes_raw?.[0]?.text.match(sizeRegex)?.[index];
        return (match !== undefined) ? match : null;
      }
      return null;
    }
    return text;
  };
  const fixUnit = (text) => {
    if (text === '"') { return 'in'; }
    if (text === '\'') { return 'ft'; }
    return text;
  };
  const resolveMaterials = (row) => {
    const output = { ...row, materials: [] };

    if (row.materials_raw[0].text !== 'null') {
      const backupMaterials = row.materials_raw.map(m => m.text);
      backupMaterials.forEach((rawMaterial) => {
        rawMaterial.split(/ and |;/).forEach((m) => {
          output.materials.push({ text: m });
        });
      });
    }
    if (row.materials_backup && row.materials_raw?.[0]?.text === 'null') {
      const backupMaterials = row.materials_backup.map(m => m.text);
      backupMaterials.forEach((backupMaterial) => {
        if (backupMaterial.length > 1) {
          backupMaterial.split(/ and |;/).forEach((m) => {
            output.materials.push({ text: m });
          });
        }
      });
    }
    return output;
  };
  const mapping = {
    width: (text, row) => extractFromRawDimensions(text, row, 1),
    length: (text, row) => extractFromRawDimensions(text, row, 3),
    height: (text, row) => extractFromRawDimensions(text, row, 5),
    dimensions_unit: (text, row) => {
      if (text === 'null') {
        if (row.dimensions_unit_backup?.[0]?.text !== undefined) {
          return fixUnit(row.dimensions_unit_backup?.[0]?.text);
        }
        return 'cm';
      }
      return fixUnit(text);
    },

  };

  const mappingFct = (header, arr, row) => [...arr.map(({ text, ...other }) => ({ text: mapping[header](text, row), ...other }))];

  data.forEach(obj => obj.group.forEach(row => Object.keys(row).forEach((header) => {
    // eslint-disable-next-line no-param-reassign
    if (mapping[header]) row[header] = mappingFct(header, row[header], row);
  })));
  // eslint-disable-next-line no-return-assign, no-param-reassign
  data.forEach(obj => obj.group = obj.group.map(row => resolveMaterials(row)));
  return data;
};

module.exports = { cleanUp };
