/* eslint-disable no-param-reassign */
/* eslint-disable linebreak-style */
/**
 *
 * @param {ImportIO.Group[]} data
 * @returns {ImportIO.Group[]}
 */

const cleanUp = (data) => {
  const mapping = {
    stock_info: (text, row) => {
      if (!row.stock_availability && text.includes('Sold out')) row.stock_availability = [{ text: 0 }];
      else row.stock_availability = [{ text: 1 }];
      return text;
    },
    description: (text, row) => {
      if (text.match(/المقاس\s*:\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*سم/)) {
        const match = text.match(/المقاس\s*:\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*سم/);
        row.length = [{ text: match[1] }];
        row.width = [{ text: match[2] }];
        row.height = [{ text: match[3] }];
      } else if (text.match(/Size: Length (\d+)cm, Width (\d+)cm, Height (\d+)cm/)) {
        const match = text.match(/Size: Length (\d+)cm, Width (\d+)cm, Height (\d+)cm/);
        row.length = [{ text: match[1] }];
        row.width = [{ text: match[2] }];
        row.height = [{ text: match[3] }];
      } else if (text.match(/الحجم\s*:\s*مقاس\s*(\d+)\s*×\s*(\d+)\s*×\s*(\d+)/)) {
        const match = text.match(/الحجم\s*:\s*مقاس\s*(\d+)\s*×\s*(\d+)\s*×\s*(\d+)/);
        row.length = [{ text: match[1] }];
        row.width = [{ text: match[2] }];
        row.height = [{ text: match[3] }];
      } else if (text.match(/القياس\s*:\s*الطول\s*(\d+)\s*سم\s*العمق\s*(\d+)\s*سم\s*الارتفاع\s*(\d+)\s*سم/)) {
        const match = text.match(/القياس\s*:\s*الطول\s*(\d+)\s*سم\s*العمق\s*(\d+)\s*سم\s*الارتفاع\s*(\d+)\s*سم/);
        row.length = [{ text: match[1] }];
        row.width = [{ text: match[2] }];
        row.height = [{ text: match[3] }];
      } else if (text.match(/Size: width (\d+) cm, depth (\d+) cm, height (\d+) cm/)) {
        const match = text.match(/Size: width (\d+) cm, depth (\d+) cm, height (\d+) cm/);
        row.depth = [{ text: match[2] }];
        row.length = [{ text: match[2] }];
        row.width = [{ text: match[1] }];
        row.height = [{ text: match[3] }];
      } else if (text.match(/Size: (\d+) x (\d+) x (\d+) cm/)) {
        const match = text.match(/Size: (\d+) x (\d+) x (\d+) cm/);
        row.length = [{ text: match[1] }];
        row.width = [{ text: match[2] }];
        row.height = [{ text: match[3] }];
      } else if (text.match(/المقاس\s*:\s*الارتفاع\s*:\s*(\d+)\s*سم\s*والعرض\s*:\s*(\d+)\s*سم\s*والعمق\s*:\s*(\d+)\s*سم/)) {
        const match = text.match(/المقاس\s*:\s*الارتفاع\s*:\s*(\d+)\s*سم\s*والعرض\s*:\s*(\d+)\s*سم\s*والعمق\s*:\s*(\d+)\s*سم/);
        row.height = [{ text: match[1] }];
        row.width = [{ text: match[2] }];
        row.depth = [{ text: match[3] }];
        row.length = [{ text: match[3] }];
      } else if (text.match(/Size: (\d+)×(\d+)×(\d+)cm/)) {
        const match = text.match(/Size: (\d+)×(\d+)×(\d+)cm/);
        row.length = [{ text: match[1] }];
        row.width = [{ text: match[2] }];
        row.height = [{ text: match[3] }];
      } else if (text.match(/Size: H(\d+)×W(\d+)×L(\d+) cm/)) {
        const match = text.match(/Size: H(\d+)×W(\d+)×L(\d+) cm/);
        row.height = [{ text: match[1] }];
        row.width = [{ text: match[2] }];
        row.length = [{ text: match[3] }];
      } else if (text.match(/المقاس\s*:\s*(\d+)\s*\*\s*(\d+)\s*سم/)) {
        const match = text.match(/المقاس\s*:\s*(\d+)\s*\*\s*(\d+)\s*سم/);
        row.width = [{ text: match[1] }];
        row.height = [{ text: match[2] }];
      } else if (text.match(/المقاس\s*:\s*(\d+)\s*\*\s*(\d+)\s*\*\s*(\d+)\s*سم/)) {
        const match = text.match(/المقاس\s*:\s*(\d+)\s*\*\s*(\d+)\s*\*\s*(\d+)\s*سم/);
        row.length = [{ text: match[1] }];
        row.width = [{ text: match[2] }];
        row.height = [{ text: match[3] }];
      } else if (text.match(/الحجم\s*:\s*(\d+)\s*×\s*(\d+)\s*×\s*(\d+)/)) {
        const match = text.match(/الحجم\s*:\s*(\d+)\s*×\s*(\d+)\s*×\s*(\d+)/);
        row.length = [{ text: match[1] }];
        row.width = [{ text: match[2] }];
        row.height = [{ text: match[3] }];
      } else if (text.match(/المقاس\s*:\s*الطول\s*:\s*(\d+)\s*سم\s*العمق\s*:\s*(\d+)\s*سم\s*الارتفاع\s*(\d+)\s*سم/)) {
        const match = text.match(/المقاس\s*:\s*الطول\s*:\s*(\d+)\s*سم\s*العمق\s*:\s*(\d+)\s*سم\s*الارتفاع\s*(\d+)\s*سم/);
        row.length = [{ text: match[1] }];
        row.depth = [{ text: match[2] }];
        row.width = [{ text: match[2] }];
        row.height = [{ text: match[3] }];
      } else if (text.match(/المقاس\s*:\s*الطول\s*(\d+)\s*سم\s*,\s*العرض\s*(\d+)\s*سم\s*,\s*الارتفاع\s*(\d+)\s*سم/)) {
        const match = text.match(/المقاس\s*:\s*الطول\s*(\d+)\s*سم\s*,\s*العرض\s*(\d+)\s*سم\s*,\s*الارتفاع\s*(\d+)\s*سم/);
        row.length = [{ text: match[1] }];
        row.width = [{ text: match[2] }];
        row.height = [{ text: match[3] }];
      } else if (text.match(/الحجم\s*:\s*مقاس الارتفاع\s*(\d+)\s*سم\s*,\s*الطول\s*(\d+)\s*سم\s*,\s*العمق\s*(\d+)\s*سم/)) {
        const match = text.match(/الحجم\s*:\s*مقاس الارتفاع\s*(\d+)\s*سم\s*,\s*الطول\s*(\d+)\s*سم\s*,\s*العمق\s*(\d+)\s*سم/);
        row.height = [{ text: match[1] }];
        row.length = [{ text: match[2] }];
        row.depth = [{ text: match[3] }];
        row.width = [{ text: match[3] }];
      } else if (text.match(/المقاس:\s*عرض\s*(\d+)\s*سم\s*,\s*العمق\s*:\s*(\d+)\s*سم\s*,\s*الارتفاع\s*:\s*(\d+)\s*سم/)) {
        const match = text.match(/المقاس:\s*عرض\s*(\d+)\s*سم\s*,\s*العمق\s*:\s*(\d+)\s*سم\s*,\s*الارتفاع\s*:\s*(\d+)\s*سم/);
        row.width = [{ text: match[1] }];
        row.depth = [{ text: match[2] }];
        row.height = [{ text: match[3] }];
      } else if (text.match(/المقاس\s*الطول\s*(\d+)\s*سم\s*,\s*العرض\s*(\d+)\s*سم\s*,\s*الارتفاع\s*(\d+)\s*سم/)) {
        const match = text.match(/المقاس\s*الطول\s*(\d+)\s*سم\s*,\s*العرض\s*(\d+)\s*سم\s*,\s*الارتفاع\s*(\d+)\s*سم/);
        row.length = [{ text: match[1] }];
        row.width = [{ text: match[2] }];
        row.height = [{ text: match[3] }];
      } else if (text.match(/المقاس\s*:\s*(\d+)\s*\*\s*(\d+)\s*\*\s*(\d+)/)) {
        const match = text.match(/المقاس\s*:\s*(\d+)\s*\*\s*(\d+)\s*\*\s*(\d+)/);
        row.length = [{ text: match[1] }];
        row.width = [{ text: match[2] }];
        row.height = [{ text: match[3] }];
      } else if (text.match(/المقاس\s*:\s*(\d+)\s*\*\s*(\d+)\s*\\\s*(\d+)\s*\*\s*(\d+)\s*\\\s*(\d+)\s*\*\s*(\d+)/)) {
        const match = text.match(/المقاس\s*:\s*(\d+)\s*\*\s*(\d+)\s*\\\s*(\d+)\s*\*\s*(\d+)\s*\\\s*(\d+)\s*\*\s*(\d+)/);
        row.length = [{ text: match[1] }, { text: match[3] }, { text: match[5] }];
        row.width = [{ text: match[2] }, { text: match[4] }, { text: match[6] }];
      }

      if (text.match(/Material: (.*)/)) {
        const match = text.match(/Material: (.*)/);
        row.material = [{ text: match[1] }];
      } else if (text.match(/Material Type: (.*)/)) {
        const match = text.match(/Material Type: (.*)/);
        row.material = [{ text: match[1] }];
      } else if (text.match(/الخامة\s*:\s*(.*)/)) {
        const match = text.match(/الخامة\s*:\s*(.*)/);
        row.material = [{ text: match[1] }];
      } else if (text.match(/Materials:(.*)/)) {
        const match = text.match(/Materials:(.*)/);
        row.material = [{ text: match[1] }];
      } else if (text.match(/نوع الخامة\s*(.*)/)) {
        const match = text.match(/نوع الخامة\s*(.*)/);
        row.material = [{ text: match[1] }];
      } else if (text.match(/الخامة\s*(.*)/)) {
        const match = text.match(/الخامة\s*(.*)/);
        row.material = [{ text: match[1] }];
      }

      if (row.colour === undefined) {
        if (text.match(/Colour: (.*)/)) {
          const match = text.match(/Colour: (.*)/);
          row.colour = [{ text: match[1] }];
        } else if (text.match(/اللون\s*:\s*(.*)/)) {
          const match = text.match(/اللون\s*:\s*(.*)/);
          row.colour = [{ text: match[1] }];
        } else if (text.match(/اللون:(.*)/)) {
          const match = text.match(/اللون:(.*)/);
          row.colour = [{ text: match[1] }];
        }
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
