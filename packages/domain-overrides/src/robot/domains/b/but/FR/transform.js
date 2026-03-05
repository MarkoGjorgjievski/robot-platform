/**
 *
 * @param {ImportIO.Group[]} data
 * @returns {ImportIO.Group[]}
 */
const cleanUp = (data) => {
  const mapping = {
    // eslint-disable-next-line consistent-return
    width: (text) => {
      const pattern1 = /\d+x\d+/;
      if (pattern1?.test(text) && text?.split('x').length === 2) {
        const dimensions = text?.split('x');
        return dimensions?.[0];
      }
      const match1 = text?.match(/x (\d+)/);
      if (match1) return match1[1];
      if (Number.isFinite(text)) return text;
    },
    // eslint-disable-next-line consistent-return
    height: (text) => {
      const pattern1 = /\d+x\d+/;
      if (pattern1?.test(text) && text?.split('x').length === 2) {
        const dimensions = text?.split('x');
        const height = dimensions?.[1].match(/\d+/);
        return height?.[0];
      }
      const match1 = text?.match(/H\.(\d+)/);
      console.log('hereeee', match1);
      const match2 = text?.match(/H\. (\d+)/);
      if (match1) {
        return match1[1];
      }
      if (match2) {
        return match2[1];
      }
      if (Number.isFinite(text)) return text;
    },
    // eslint-disable-next-line consistent-return
    length: (text) => {
      const match1 = text?.match(/L\.(\d+)/);
      const match2 = text?.match(/L\. (\d+)/);
      const match3 = text?.match(/^(\d+)/);

      if (match1) return match1[1];
      if (match2) return match2[1];
      if (match3) return match3[1];
      if (Number.isFinite(text)) return text;
    },
    // eslint-disable-next-line consistent-return
    depth: (text) => {
      const match1 = text?.match(/P\.(\d+)/);
      const match2 = text?.match(/P\. (\d+)/);
      if (match1) return match1[1];
      if (match2) return match2[1];
      if (Number.isFinite(text)) return text;
    },
    // eslint-disable-next-line consistent-return
    diameter: (text) => {
      const match1 = text?.match(/D\.(\d+)/);
      const match2 = text?.match(/D\. (\d+)/);
      if (match1) return match1[1];
      if (match2) return match2[1];
      if (Number.isFinite(text)) return text;
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
