/* eslint-disable no-param-reassign */
/**
 *
 * @param {ImportIO.Group[]} data
 * @returns {ImportIO.Group[]}
 */
const cleanUp = (data) => {
  let isEventURL = false;

  data.forEach(({ group }) => {
    group.forEach((row) => {
      if ('eventURL' in row) {
        isEventURL = true;
        row.eventURL = row.eventURL.filter(({ xpath }) => xpath !== undefined);
      }
    });
  });

  if (isEventURL) {
    data.forEach((obj) => {
      if ('group' in obj) {
        obj.group = obj.group.filter(row => (row.eventURL || []).length > 0);
        obj.rows = obj.group.length;
      }
    });

    return data.filter(({ rows }) => rows > 0);
  }

  const mapping = {
    jsonVenueName: (text, row) => {
      if ((row.venueName === undefined || row.venueName.length === 0) && text) {
        row.venueName = [{ ...row.jsonVenueName[0] }];
      }
      return text;
    },
    jsonVenueCity: (text, row) => {
      if ((row.venueCity === undefined || row.venueCity.length === 0) && text) {
        row.venueCity = [{ ...row.jsonVenueCity[0] }];
      }
      return text;
    },
    jsonEventDateTime: (text, row) => {
      if (
        (row.eventDateTime === undefined || row.eventDateTime.length === 0)
        && text
      ) {
        const utcDate = new Date(parseInt(text, 10) * 1000);
        const timezoneFixed = new Date(
          utcDate.getTime() + utcDate.getTimezoneOffset() * 60 * 1000,
        );
        row.eventDateTime = [{ text: timezoneFixed.toISOString() }];
      }
      return text;
    },
    jsonIsPublicPurchase: (text, row) => {
      if (
        (row.isPublicPurchase === undefined
          || row.isPublicPurchase.length === 0)
        && text
      ) {
        row.isPublicPurchase = [{ ...row.jsonIsPublicPurchase[0] }];
      }
      return text;
    },
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
