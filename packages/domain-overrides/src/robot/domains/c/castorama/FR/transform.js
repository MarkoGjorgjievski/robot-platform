/**
 *
 * @param {ImportIO.Group[]} data
 * @returns {ImportIO.Group[]}
 */
const cleanUp = (data) => {
  const mapping = {
    offer_price: (text, row) => {
      if (!row.original_price) {
        // eslint-disable-next-line no-param-reassign
        row.original_price = [{ text: `${text}` }];
        return null;
      }
      return text;
    },
    stars: (text, row) => {
      const rating = row.average_rating?.[0]?.text;
      let star = 0;
      if (text === 'Evaluation du produit. Etoile vide') star = 0;
      if (text === 'Evaluation du produit. Etoile à moitié remplie') star = 0.5;
      if (text === 'Evaluation du produit. Classement à 5 étoiles') star = 1;
      // eslint-disable-next-line no-param-reassign
      row.average_rating = [{ text: `${parseFloat(rating) + star}` }];
      return text;
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
