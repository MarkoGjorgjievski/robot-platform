/* eslint-disable */

const transformValues = (data) => {
  data.forEach((el) => {
    el.group.forEach((row, index) => {
      row.rank = [{ text: ++index }];
      if (row.searchResultType[0].text === 'Promoted') {
        row.searchResultType = [{ text: 'paid' }];
      }
      if (index < 5) {
        row.aboveFold = [{ text: 'true' }];
      } else {
        row.aboveFold = [{ text: 'false' }];
      }
    });
  });
  return data;
};

module.exports = { transformValues };
