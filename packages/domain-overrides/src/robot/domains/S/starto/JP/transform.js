/**
 *
 * @param {ImportIO.Group[]} data
 * @returns {ImportIO.Group[]}
 */
const cleanUp = (data) => {
  // eslint-disable-next-line object-curly-newline
  function removeSquareBrackets(str) {
    // Using regex to replace square brackets
    return str.replace(/[[\]]/g, '');
  }
  // function formatDateFromString(dateString) {
  //   // Split the string by the delimiter "."
  //   const parts = dateString.split('.');
  //
  //   // Extract year, month, and day from the parts
  //   const year = parts[0];
  //   const month = parts[1];
  //   const day = parts[2].split('（')[0]; // Extracting the day and removing any additional characters
  //
  //   // Pad the month and day with leading zeros if necessary
  //   const formattedMonth = month.padStart(2, '0');
  //   const formattedDay = day.padStart(2, '0');
  //
  //   // Return the formatted date
  //   return `${year}-${formattedMonth}-${formattedDay}`;
  // }
  function properName(text1, text2) {
    // eslint-disable-next-line no-nested-ternary
    return text2 && text1.includes(text2) ? text1 : text2 ? `${text1} - ${text2}` : text1;
  }
  function removeNonAlphanumeric(str) {
    // Using regex to replace non-alphanumeric characters
    return str.replace(/[^\w\s]/g, '');
  }
  // function extractDateFromString(string) {
  //   // Define the pattern to search for dates in the formats yyyy.mm.dd
  //   const pattern = /(\d{4}\.\d{2}\.\d{2})/;
  //   // Search for the pattern in the string
  //   const match = string.match(pattern);
  //   // If a match is found, return the date
  //   if (match) {
  //     return match[1];
  //   }
  //   return null;
  // }

  function extractDateFromString(string) {
    // Define an array of patterns to search for dates in different formats
    const patterns = [
      /(\d{4}\.\d{2}\.\d{2})/, // yyyy.mm.dd
      /(\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+\d{4})/, // Month dd, yyyy
    ];

    // Iterate through each pattern and search for a match in the string
    // eslint-disable-next-line no-restricted-syntax
    for (const pattern of patterns) {
      const match = string.match(pattern);
      // If a match is found, convert it to YYYY-MM-DD format and return
      if (match) {
        const date = new Date(match[0]);
        return date.toISOString().split('T')[0];
      }
    }

    // If no match is found, return null
    return null;
  }
  // const ep = (ticketData, venueCity) => {
  //   if (ticketData.length > 1) {
  //     const matchingTicket = ticketData.find(ticket => ticket.text.includes(removeNonAlphanumeric(venueCity?.[0]?.text)));
  //     return matchingTicket ? extractDateFromString(matchingTicket.text) : '----';
  //   }
  //   return extractDateFromString(ticketData?.[0]?.text);
  // };
  const ep = (ticketData, venueCity) => {
    if (ticketData.length > 1) {
      const matchingTicket = ticketData.find(ticket => ticket.text.includes(removeNonAlphanumeric(venueCity?.[0]?.text.split(' ')?.[0])));
      return matchingTicket ? extractDateFromString(matchingTicket.text) : '----';
    }
    return extractDateFromString(ticketData?.[0]?.text);
  };
  const mapping = {
    nameTitle: (text, row) => {
      // eslint-disable-next-line no-param-reassign
      row.eventName = [{ text: properName(text, row.nameTitle2?.[0]?.text) }];
    },
    venueCity: text => removeSquareBrackets(text),
    // eventDate: text => formatDateFromString(text)?.split(' ')?.[0],
    isTBA: text => (text === '1' ? '1' : '0'),
    // isPublicPurchase: text => (text === '1' ? '1' : '0'),
    isPublicPurchaseModifier: (text, row) => {
      // eslint-disable-next-line no-param-reassign
      row.isPublicPurchase = [{ text: row.isPublicPurchase?.[0]?.text === '1' ? '1' : '0' }];
    },
    ticketData: (text, row) => {
      // removeSquareBrackets(row.venueCity?[0]?.text)
      // eslint-disable-next-line sonarjs/no-extra-arguments,no-param-reassign
      row.onSaleDate = [{ text: ep(row?.ticket, row?.venueCity) }];
      // row.onSaleDate = [{ text: '10-10-2121' }];
    },
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
