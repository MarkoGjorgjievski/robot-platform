/* eslint-disable no-param-reassign */
/**
 *
 * @param {ImportIO.Group[]} data
 * @returns {ImportIO.Group[]}
 */
const cleanUp = (data) => {
  const mapping = {
    // productURL: text => `https://tickets.interpark.com/goods/${text}`,
    eventURLJQ: (text, row) => {
      console.log('rowwww', row);

      return `https://tickets.interpark.com/goods/${text}`;
    },
    // playSeq: (text) =>
    //   JSON.parse(JSON.parse(text)).data.map((date) => ({
    //     text: date.playSeq,
    //   })),
    // eventDate: (text) =>
    //   JSON.parse(JSON.parse(text)).data.map((date) => ({
    //     text: `${date.playDate.slice(0, 4)}-${date.playDate.slice(
    //       4,
    //       6
    //     )}-${date.playDate.slice(6)}`,
    //   })),
  };

  const mappingFct = (header, arr, row) => arr.map(({ text, ...other }) => ({
    text: mapping[header](text, row),
    ...other,
  }));

  data.forEach(obj => obj.group.forEach(row => Object.keys(row).forEach((header) => {
    if (mapping[header]) row[header] = mappingFct(header, row[header], row);
  })));

  return data;
};

module.exports = { cleanUp };
