/**
 *
 * @param {ImportIO.Group[]} data
 * @returns {ImportIO.Group[]}
 */
const cleanUp = (data) => {
  const mapping = {
    tags: (text, row) => {
      let tags = text === 'true' ? 'Verified Review' : '';
      if (row.invited_user?.[0]?.text === 'invited') {
        if (tags !== '') tags += ', ';
        tags += 'Invited User';
      }
      if (row.verified_user?.[0]?.text === 'true') {
        if (tags !== '') tags += ', ';
        tags += 'Verified User';
      }

      return tags;
    },
    review_body: (text, row) => {
      if (text === row.review_title?.[0]?.text) return '';
      return text;
    },
    review_id: text => `https://www.trustpilot.com/reviews/${text}`,
  };

  const mappingFct = (header, arr, row) => arr.map(({ text, ...other }) => ({ text: mapping[header](text, row), ...other }));

  data.forEach(obj => obj.group.forEach(row => Object.keys(row).forEach((header) => {
    // eslint-disable-next-line no-param-reassign
    if (mapping[header]) row[header] = mappingFct(header, row[header], row);
  })));

  return data;
};

module.exports = { cleanUp };
