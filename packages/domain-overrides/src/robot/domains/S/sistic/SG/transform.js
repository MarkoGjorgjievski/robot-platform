/* eslint-disable no-shadow */
/* eslint-disable eqeqeq */
/* eslint-disable prefer-destructuring */
/* eslint-disable no-param-reassign */
/**
 *
 * @param {ImportIO.Group[]} data
 * @returns {ImportIO.Group[]}
 */
//
const cleanUp = (data) => {
  const mapping = {

    venueAddress: (text, row) => {
      let extractedPostalCode;
      text = text.replace(/\.*$/, '');

      // Extract and remove postal code
      const postalCodeMatch = text.match(/(\d{6})$/);
      if (postalCodeMatch) {
        // eslint-disable-next-line prefer-destructuring
        extractedPostalCode = postalCodeMatch[1];
        text = text.replace(postalCodeMatch[0], '').trim();
      }

      text = text.replace('Singapore', '').trim();

      const address = text;
      row.postalCode = [{ text: extractedPostalCode }];
      return address;
    },
    // ticketButtonValue: (text, row) => {
    //   if (text == '0') {
    //     row.isPublicPurchase = [{ text: '1' }];
    //   }
    //   return text;
    // },
    eventDate: (text, row) => {
      const eventTime = text;
      let time = '15:00';

      let timeSlotText = eventTime.match(/\b(\d+(\.\d+)?)\s*(pm|am)\b/g);
      if (!timeSlotText) {
        timeSlotText = row.eventTime[0]?.text?.match(/(\d{1,2}[:.]\d{2}(?:[^\d\s]{0,5})?(?:pm|am)|\d{1,2}(?:[^\d\s]{0,5})?(?:pm|am))/);
      }
      if (timeSlotText) {
        time = timeSlotText[0];
        const isPM = time.includes('pm');
        if (!time.includes('.')) {
          time += ':00';
        } else {
          time = time.replace('.', ':');
        }
        time = time.replace('am', '');
        time = time.replace('pm', '');
        if (time) {
          const timeSlot = time?.split(':')?.map(time => time);
          const [hours12, minutes] = timeSlot;
          let hours = Number(hours12);
          if (isPM && hours !== 12) hours += 12;
          const formattedTime = `${hours}:${minutes}`;
          row.eventTime = [{ text: formattedTime }];
        }
      }

      return text;
    },
    eventID: (text, row) => {
      // eslint-disable-next-line no-param-reassign
      row.eventURL = [{ text: `https://www.sistic.com.sg/events/${text}` }];
      return text;
    },
    onSaleDateTime: (text, row) => {
      if (text === '0000-00-00 00:00:00') return null;
      let validDateTime = '00/00/0000, 00:00'; // or null if not found
      let matchDate;
      let firstDigitPos = -1;
      let textAfterStartSales = '';

      let match = /Start Sales Date\n([\s\S]*)/.exec(text);

      if (!match) {
        match = /Start Sales([\s\S]*)/.exec(text);
      }

      if (match && match[1]) {
        textAfterStartSales = match[1].trim();
        firstDigitPos = textAfterStartSales.search(/\d/); // Position of the first digit
      }
      if (firstDigitPos !== -1) {
        const afterFirstDigit = textAfterStartSales.substring(firstDigitPos); // Text after the first digit
        matchDate = /(\d{1,2} \w+ \d{4})\s*,\s*(\d{1,2}(am|pm))/.exec(afterFirstDigit);
      }

      if (matchDate) {
        const date = matchDate[1];
        const time = matchDate[2];
        validDateTime = `${date},${time}`;
      } else if (row.publicSaleDateTime) {
        match = /Public Sale([\s\S]*)/.exec(row.publicSaleDateTime[0]?.text);

        if (match && match[1]) {
          const textAfterPublicSales = match[1].trim();
          const firstDigitPos = textAfterPublicSales.search(/\d/); // Position of the first digit
          if (firstDigitPos !== -1) {
            const afterFirstDigit = textAfterPublicSales.substring(firstDigitPos); // Text after the first digit
            const matchTwo = /(\d{1,2} \w+ \d{4})\s*,\s*(\d{1,2}(am|pm))/.exec(afterFirstDigit);
            if (matchTwo) {
              const date = matchTwo[1];
              const time = matchTwo[2];
              // @ts-ignore
              validDateTime = `${date},${time}`;
              // console.log(date + ',', time);  // Should print "11 July 2023, 12am"
            }
          }
        }
      }

      // eslint-disable-next-line prefer-const
      let [date, time] = validDateTime.split(',');

      const isPM = time.includes('pm');
      time = time.replace('am', '');
      time = time.replace('pm', '');
      if (!time.includes('.')) {
        time += ':00';
      } else {
        time = time.replace('.', ':');
      }
      if (time) {
        const timeSlot = time?.split(':')?.map(time => time);
        const [hours12, minutes] = timeSlot;
        let hours = Number(hours12);
        if (isPM && hours !== 12) hours += 12;

        // convert to UTC
        hours -= 8;
        const formattedDateTime = `${date} ${hours}:${minutes} UTC`;
        const finalDate = new Date(formattedDateTime);
        // @ts-ignore
        if (finalDate != 'Invalid Date') {
          return finalDate.toISOString();
        }
      }
      return text;
    },
    isPublicPurchase: (text, row) => {
      if (row.ticketButtonValue?.[0]?.text === '0') {
        return 1;
      }
      if (row.buyPackageStatus?.[0]?.text === '1') {
        return 1;
      }
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
