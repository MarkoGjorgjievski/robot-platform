/* eslint-disable no-param-reassign */
/**
 *
 * @param {ImportIO.Group[]} data
 * @returns {ImportIO.Group[]}
 */
//
const cleanUp = (data) => {
  const SELECT_TICKETS_TITLE = 'Escolha seus ingresso';
  const mapping = {
    venueAddress: (text, row) => {
      const cuts = text.split('-').map(item => item.trim());
      if (row.venueName === cuts[0]) {
        return cuts[1] ? cuts[1] : cuts[0];
      }
      return cuts[0] ? cuts[0] : row.venueName;
    },
    eventTime: (text, row) => {
      let time = text.split('•');
      time = time[time.length - 1];
      if (time.includes('Início')) {
        row.isDateTimeTBA = [{ text: 0 }];
        return time.split('Início:')[1].trim();
      }
      if (time.includes('Abertura')) {
        row.isDateTimeTBA = [{ text: 0 }];
        return time.split('Abertura:')[1].trim();
      }
      row.isDateTimeTBA = [{ text: 1 }];
      return '15:00';
    },
    previousURL: (text, row) => {
      row.eventURL = [{ text }];
      return text;
    },
    postalCode: (text) => {
      const cuts = text.split(',').map(item => item.trim());
      return cuts[cuts.length - 1];
    },
    eventUniqueId: (text, row) => row.eventID?.[0]?.text,
    selectTicketsTitle: (text, row) => {
      const buyTicketsButton = row.buyTicketsButton?.[0]?.text;
      const selectTicketsIframe = row.selectTicketsIframe?.[0]?.text;
      const selectTicketsTitle = text;

      let isPublicPurchaseValue = '0';

      if (
        buyTicketsButton
        || (selectTicketsIframe
          && selectTicketsTitle
            .toLowerCase()
            .includes(SELECT_TICKETS_TITLE.toLowerCase()))
      ) isPublicPurchaseValue = '1';

      row.isPublicPurchase = [{ text: isPublicPurchaseValue }];

      return text;
    },
  };

  const mappingFct = (header, arr, row) => [
    ...arr.map(({ text, ...other }) => ({
      text: mapping[header](text, row),
      ...other,
    })),
  ];

  data.forEach(obj => obj.group.forEach(row => Object.keys(row).forEach((header) => {
    // eslint-disable-next-line no-param-reassign
    if (mapping[header]) row[header] = mappingFct(header, row[header], row);
  })));
  return data;
};

module.exports = { cleanUp };
