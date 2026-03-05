/* eslint-disable no-param-reassign */
/**
 *
 * @param {ImportIO.Group[]} data
 * @returns {ImportIO.Group[]}
 */
const cleanUp = (data) => {
  const mapping = {
    eventTime: (text, row) => {
      if (text === '-1') {
        row.isDateTimeTBA = [{ text: 1 }];
        return '13:00';
      }
      return text;
    },
    eventStrongName: (text, row) => {
      if (text) {
        row.eventName = [{ text: row.eventStrongName[0].text }];
      }
      if (text.indexOf('Concert ') !== -1) {
        text = text.replace('Concert ', '');
      }
      return text;
    },
    venueCity: (text, row) => {
      if (row.venueCity && row.venueCity.length > 1) {
        return row.venueCity[1].text;
      }
      return text;
    },
    eventNormalName: (text, row) => {
      if (text && !row.eventName) {
        let eventName = row.eventNormalName[0].text;
        if (eventName.indexOf(': ') !== -1) {
          // eslint-disable-next-line prefer-destructuring
          eventName = eventName.split(': ')[1];
        }
        if (eventName.indexOf(' • ') !== -1) {
          // eslint-disable-next-line prefer-destructuring
          eventName = eventName.split(' • ')[0];
        }
        if (eventName.indexOf(' - ') !== -1) {
          const eventNameDestructured = eventName.split(' - ');
          const indexOfTitle = eventNameDestructured[0].indexOf('SOLD OUT') !== -1 ? 1 : 0;
          if (eventNameDestructured[indexOfTitle].indexOf('Concert ') !== -1) {
            eventNameDestructured[indexOfTitle] = eventNameDestructured[indexOfTitle].replace('Concert ', '');
          }
          row.eventName = [{ text: eventNameDestructured[indexOfTitle] }];
        } else {
          if (eventName.indexOf('Concert ') !== -1) {
            eventName = eventName.replace('Concert ', '');
          }
          row.eventName = [{ text: eventName }];
        }
      }
      return text;
    },
    isPublicPurchase: (text, row) => {
      const truePublicPurchase = ['Alege locuri', 'Cumpără bilete', 'Biletele nu se mai pot cumpăra online.', 'Stoc de bilete epuizat.'];
      let isPublicPurchase = 0;
      let eventNoteText = '';
      if (row.eventNote && row.eventNote.length > 1) {
        row.eventNote.forEach((eventNote) => {
          eventNoteText += ` ${eventNote.text}`;
        });
        row.eventNote = [{ text: eventNoteText }];
      }
      truePublicPurchase.forEach((phrase) => {
        if (phrase.includes(text)) {
          console.log(phrase.includes(text));
          isPublicPurchase = 1;
        }
      });
      return isPublicPurchase;
    },
    venueAddress: (text, row) => {
      if (row.venueCity && text.indexOf(row.venueCity[0].text) !== -1) {
        text.replace(row.venueCity[0].text, '');
      }
      if (row.postalCode && text.indexOf(row.postalCode[0].text) !== -1) {
        text.replace(row.postalCode[0].text, '');
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
