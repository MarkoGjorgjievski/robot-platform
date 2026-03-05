/**
 *
 * @param {ImportIO.Group[]} data
 * @returns {ImportIO.Group[]}
 */

const cleanUp = (data) => {
  const mapping = {
    height: text => [
      /Höhe:\s*[ca.,\s]*\s*(\d+[,.]?\d*)/,
      /(?:Maße|Stellmaße):\s*[ca.,\s]*\s*[BxHxT]*\s*[ca.,\s]*\s*(?:.+)\s*x\s*(\d+[.,]?\d*)\s*x?\s*(?:.+)?cm/,
    ]
      .filter(pattern => pattern.test(text))
      .map(pattern => text.match(pattern)?.[1])?.[0]?.split(/[^,.0-9]/)?.[0],
    width: text => [
      /(?:Maße|Stellmaße):\s*[ca.,\s]*\s*[BxHxT]*\s*[ca.,\s]*\s*(\d+[.,]?\d*)\s*x\s*(?:.+)\s*x?\s*(?:.+)?cm/,
    ]
      .filter(pattern => pattern.test(text))
      .map(pattern => text.match(pattern)?.[1])?.[0]?.split(/[^,.0-9]/)?.[0],
    depth: text => [
      /(?:Maße|Stellmaße):\s*[ca.,\s]*\s*[BxHxT]*\s*[ca.,\s]*\s*(\d+[.,]?\d*)\s*x\s*(?:.+)\s*x\s*(\d+[.,]?\d*)\s*cm/,
    ]
      .filter(pattern => pattern.test(text))
      .map(pattern => text.match(pattern)?.[1])?.[0],
    length: text => [/Länge:\s*[ca.,\s]*\s*(\d+[,.]?\d*)/]
      .filter(pattern => pattern.test(text))
      .map(pattern => text.match(pattern)?.[1])?.[0],
  };

  const mappingFct = (header, arr) => [
    ...arr.map(({ text, ...other }) => ({
      text: mapping[header](text),
      ...other,
    })),
  ];

  data.forEach(obj => obj.group.forEach(row => Object.keys(row).forEach((header) => {
    // eslint-disable-next-line no-param-reassign
    if (mapping[header]) row[header] = mappingFct(header, row[header]);
  })));
  return data;
};

module.exports = { cleanUp };
