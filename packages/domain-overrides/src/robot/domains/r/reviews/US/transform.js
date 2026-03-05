/* eslint-disable no-param-reassign */
/**
 *
 * @param {ImportIO.Group[]} data
 * @returns {ImportIO.Group[]}
 */
const cleanUp = (data) => {
  const mapping = {
    review_id: (text, row) => `${row.currentUrl?.[0]?.text}/${text}`.replace(/\/company-reviews\//, '/company-review/'),
    review_date: (text) => {
      const relativeTimeRegex = /Posted (\d+) (second|minute|hour|day|week|month|year)s? ago/;
      const match = text.match(relativeTimeRegex);
      if (match) {
        const value = parseInt(match[1], 10);
        const unit = match[2];

        const now = new Date();

        switch (unit) {
          case 'second':
            now.setSeconds(now.getSeconds() - value);
            break;
          case 'minute':
            now.setMinutes(now.getMinutes() - value);
            break;
          case 'hour':
            now.setHours(now.getHours() - value);
            break;
          case 'day':
            now.setDate(now.getDate() - value);
            break;
          case 'week':
            now.setDate(now.getDate() - value * 7);
            break;
          case 'month':
            now.setMonth(now.getMonth() - value);
            break;
          case 'year':
            now.setFullYear(now.getFullYear() - value);
            break;
          default:
            return text;
        }
        return now.toISOString();
      }
      return text;
    },

    rating: (text, row) => {
      let ratingValue = 5;
      row.stars?.forEach((star) => {
        if (star?.text.includes('stars__icon--0')) ratingValue -= 1;
      });
      return ratingValue.toString();
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
