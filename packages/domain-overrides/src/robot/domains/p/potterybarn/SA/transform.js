/**
 *
 * @param {ImportIO.Group[]} data
 * @returns {ImportIO.Group[]}
 */
const cleanUp = (data) => {
  const mapping = {
    height: (text) => {
      const pattern1 = /(\d+(\.\d+)?)\D*h/;
      const pattern2 = /(\d+(\.\d+)?)\D*high/;

      const match1 = text.match(pattern1);
      const match2 = text.match(pattern2);

      return match1?.[1] || match2?.[1];
    },
    depth: (text) => {
      const pattern1 = /(\d+(\.\d+)?)\D*d/;
      const pattern2 = /(\d+(\.\d+)?)\D*deep/;

      const match1 = text.match(pattern1);
      const match2 = text.match(pattern2);

      return match1?.[1] || match2?.[1];
    },
    width: (text) => {
      const pattern1 = /(\d+(\.\d+)?)\D*w/;
      const pattern2 = /(\d+(\.\d+)?)\D*wide/;

      const match1 = text.match(pattern1);
      const match2 = text.match(pattern2);

      return match1?.[1] || match2?.[1];
    },
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
