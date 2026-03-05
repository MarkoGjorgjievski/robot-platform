/* eslint-disable no-unsafe-optional-chaining */
/* eslint-disable linebreak-style */
/* eslint-disable no-param-reassign */
/**
 *
 * @param {ImportIO.Group[]} data
 * @returns {ImportIO.Group[]}
 */
const cleanUp = (data) => {
  const mapping = {
    eventName: (text) => {
      const pipeIndex = text.indexOf('|');
      const dashIndex = text.indexOf('-');
      let signIndex = -1;

      if (pipeIndex !== -1) {
        signIndex = pipeIndex;
      } else if (dashIndex !== -1) {
        signIndex = dashIndex;
      }
      return signIndex !== -1 ? text.slice(0, signIndex) : text;
    },
    eventDate: (text, row) => {
      const dateRegex = /"startDate"\s*:\s*"(\d{4}-\d{2}-\d{2})/;
      const timeRegex = /"startDate"\s*:\s*"\d{4}-\d{2}-\d{2}\s(\d{2}:\d{2})"/;
      const dateMatch = dateRegex.exec(text);
      const timeMatch = timeRegex.exec(text);
      row.eventTime[0].text = timeMatch ? timeMatch[1] : '13:00';
      console.log(timeMatch ? timeMatch[1] : 'null');
      return dateMatch && dateMatch.length > 1 ? dateMatch[1] : null;
    },
    isDateTimeTBA: (text, row) => (row.eventTime?.[0]?.text === 'dummy' ? '1' : '0'),
    venueAddress: (text) => {
      const textArr = text.split(',');
      if (!textArr) return text;
      return text.split(',').slice(1, -1).join(',');
    },
    postalCode: (text, row) => {
      if (text !== 'dummy') return text;
      const regex = /\b\d{3}\s*\d{2}\b/;
      return row.venueData?.[0]?.text.match(regex) ? row.venueData?.[0]?.text.match(regex)[0] : null;
    },
    venueCity: (text, row) => {
      const cityNameRegex = /[a-zA-Z\u00C0-\u017F\s\-']+/g;
      const cityNameMatches = text.match(cityNameRegex);
      if (cityNameMatches) return cityNameMatches.join('').trim();
      return row.venueData?.[0]?.text ? row.venueData?.[0]?.text.split(',')[row.venueData?.[0]?.text.split(',').length - 2].trim() : null;
    },
    isPublicPurchase: text => (text ? '1' : '0'),
  };

  const mappingFct = (header, arr, row) => [...arr.map(({ text, ...other }) => ({ text: mapping[header](text, row), ...other }))];

  data.forEach(obj => obj.group.forEach(row => Object.keys(row).forEach((header) => {
    // eslint-disable-next-line no-param-reassign
    if (mapping[header]) row[header] = mappingFct(header, row[header], row);
  })));
  return data;
};

module.exports = { cleanUp };
