/**
 *
 * @param {ImportIO.Group[]} data
 * @returns {ImportIO.Group[]}
 */
const cleanUp = (data) => {
  const findKeywordMatch = (str) => {
    const keywords1 = ['pack of', 'box of', 'bag of', 'pouch of'];
    const keywords2 = ['capsule', 'bottle', 'syringe', 'tube', 'sticks', 'cakes', 'litre', 'metre', 'bag', 'box', 'pouch', 'pack'];

    const regex1 = new RegExp(`(${keywords1.join('|')}) (\\d+)`, 'i');
    const regex2 = new RegExp(`(\\d+) x (\\d+.*?) (${keywords2.join('|')})`, 'i');
    const regex3 = /(\d+) x .*/;
    const regex4 = /\((\d+)\)/;
    const regex5 = new RegExp(`(\\d+(?:\\.\\d+)?)\\s*([a-zA-Z]*)\\s*(${keywords2.join('|')})`, 'i');

    const str2 = str.toLowerCase();

    const match1 = regex1.exec(str2);
    const match2 = regex2.exec(str2);
    const match3 = regex3.exec(str2);
    const match4 = regex4.exec(str2);
    const match5 = regex5.exec(str2);

    if (match1) {
      return match1.slice(1).join(' ');
    }

    if (match2) {
      return `${match2[1]} x ${match2[2]} ${match2[3]}`;
    }

    if (match5) {
      return `${match5[0]}`;
    }

    if (match3) {
      return match3[1];
    }

    if (match4 && /^\d+$/.test(match4[1])) {
      return match4[1];
    }

    return null;
  };

  const wrapperMatcher = (str) => {
    const replaceColon = str.toLowerCase().replace(/:/g, '-');
    const splitByDash = replaceColon.split('-');

    return splitByDash.find(word => findKeywordMatch(word));
  };

  const mapping = {
    name: (text, row) => {
      let uom;

      if (row.uom) {
        if (row.uom.length > 1) {
          uom = `Set of ${row.uom.length}`;
        } else {
          uom = findKeywordMatch(row.uom[0].text);
        }
      }

      if (!uom) {
        uom = wrapperMatcher(text);
      }

      if (!uom) {
        uom = '1';
      }
      // eslint-disable-next-line no-param-reassign
      row.uom = [{ text: uom }];
    },
  };

  const mappingFct = (header, arr, row) => [...arr.map(({ text, ...other }) => ({ text: mapping[header](text, row), ...other }))];

  data.forEach(obj => obj.group.forEach(row => Object.keys(row).forEach((header) => {
    // eslint-disable-next-line no-param-reassign
    if (mapping[header]) row[header] = mappingFct(header, row[header], row);
  })));
  return data;
};

module.exports = { cleanUp };
