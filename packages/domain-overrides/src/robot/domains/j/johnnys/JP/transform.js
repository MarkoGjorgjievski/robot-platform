/**
 *
 * @param {ImportIO.Group[]} data
 * @returns {ImportIO.Group[]}
 */
const cleanUp = (data) => {
  // function extractTextFromBrackets(text) {
  //   // Regular expression to match text inside square brackets
  //   const regex = /\[(.*?)\]/;
  //   const match = text.match(regex);
  //
  //   // Check if we have a match
  //   if (match && match[1]) {
  //     // Return the first capturing group (text inside the brackets)
  //     return match[1];
  //   }
  //   // Return an empty string if there's no match
  //
  //   return '';
  // }
  //
  // function formatDateFromString(dateStr) {
  //   // Extract month and day from the input string
  //   const dateParts = dateStr.match(/(\d+)\/(\d+)/); // Use regex to find month and day
  //
  //   if (!dateParts) {
  //     return 'Invalid date'; // Return an error message or handle as needed
  //   }
  //
  //   const currentYear = new Date().getFullYear();
  //
  //   // Create a new date object using the extracted month and day
  //   // Note: Months are 0-indexed in JavaScript Date objects
  //   const date = new Date(currentYear, dateParts[1] - 1, dateParts[2]);
  //
  //   // Adjust for timezone to get the correct date in ISO format
  //   // The getTimezoneOffset returns the difference in minutes, so convert it to milliseconds
  //   const timeZoneOffset = date.getTimezoneOffset() * 60000;
  //   const adjustedDate = new Date(date.getTime() - timeZoneOffset);
  //
  //   // Format the date into ISO 8601 format (YYYY-MM-DD)
  //   return adjustedDate.toISOString().substring(0, 10);
  // }
  //
  // const takeIdFromUrl = (url) => {
  //   const arr = url.split('#');
  //   return arr[0];
  // };

  // eslint-disable-next-line object-curly-newline

  // const returnCorrectUrl = text => (text.includes('..')
  //   ? text.replace('../', 'https://ticket.pia.jp/sp/')
  //   : text)

  // function extractFirstTime(str) {
  //   // Regular expression to match a time pattern (HH:MM)
  //   const arr = str.split(' ')
  //   return arr[0];
  // }
  function extractName(input) {
    // This regex matches text within 『』 or 「」 brackets.
    const match = input.match(/『(.*?)』|「(.*?)」/);

    // If a match is found, return the first non-undefined group.
    return match ? (match[1] || match[2]) : input;
  }

  // function extractStartTime(input) {
  //   const timePattern = /\d{2}:\d{2}/;
  //   const match = input.match(timePattern);
  //   return '11:00';
  // }

  const returnProper = (text) => {
    const arr = text?.split('(');
    return arr[0];
  };

  const returnVenueCity = (text) => {
    const regex = '\\(([^)]+)\\)';
    const match = text.match(regex);
    return match[1] || text;
  };

  // eslint-disable-next-line object-curly-newline
  const mapping = {
    venueName: text => returnProper(text),
    eventDate: text => returnProper(text),
    venueCity: text => returnVenueCity(text),
    // isPublicPurchase: text => (text === 'no' ? '0' : '1'),
    // eventTime: text => `22:00 ------ ${text}`,
    eventName: text => extractName(text),
    // firstDepthURL: text => returnCorrectUrl(text),
    // timeAccent: (text, row) => {
    //   // eslint-disable-next-line no-param-reassign
    //   row.eventTime = [{ text: row.eventTime[0].text }];
    //   // eslint-disable-next-line no-param-reassign
    //   row.eventTime2 = [{ text: 'nope' }];
    // },

    // venueCity: text => extractTextFromBrackets(text),
    // eventDate: text => formatDateFromString(text) || null,
    // isPublicPurchase: text => (text === 'no' ? '0' : '1'),
    // secondDepthURL: text => `https://www.johnnys-net.jp${text}`,
    // eventURL: text => `https://www.johnnys-net.jp${takeIdFromUrl(text)}`,
    // eslint-disable-next-line object-curly-newline

    IsPublicPurchase: text => (text === 'no' ? 'no' : 'yes'),
  };
  const mappingFct = (header, arr, row) => [...arr.map(({
    text,
    ...other
  }) => ({ text: mapping[header](text, row), ...other }))];

  data.forEach(obj => obj.group.forEach(row => Object.keys(row).forEach((header) => {
    // eslint-disable-next-line no-param-reassign
    if (mapping[header]) row[header] = mappingFct(header, row[header], row);
  })));
  return data;
};

module.exports = { cleanUp };
