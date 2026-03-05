/**
 *
 * @param {ImportIO.Group[]} data
 * @returns {ImportIO.Group[]}
 */

const cleanUp = (data) => {
  const dateFormatting = (dateToFormat) => {
    const spanishMonts = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julion', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
    let date = dateToFormat;
    let day;
    let month;
    let year;

    date = date.replace('.', ' ');
    date = date.replace('/', ' ');
    date = date.replace('-', ' ');
    date = date.replace('(', ' ');

    date = date.replace(/\s+/g, ' ');
    date = date.trim();
    const words = date.split(' ');

    words.forEach((x) => {
      if (/^[0-9]{1,2}$/.test(x)) {
        day = x;
      } else if (/[0-9]{4}/.test(x)) {
        year = x;
      } else if (/[a-z]+/.test(x) && x.length >= 3) {
        spanishMonts.forEach((m) => {
          if (m.startsWith(x)) {
            month = spanishMonts.indexOf(m) + 1;
          }
        });
      }
    });

    if (year == null) {
      const newDateTime = new Date();
      if (month && month >= (newDateTime.getMonth() + 1)) {
        year = new Date().getFullYear();
      } else {
        year = new Date().getFullYear() + 1;
      }
    }

    if (!month) return null;

    return `${year}/${month}/${day}`;
  };

  const mapping = {
    eventDateTime: (text, row) => {
      const dateRegex = /^((?! \d{1,2}:\d{2}).)*/;
      const hourRegex = /\d{1,2}:\d{2}/;
      const date = dateFormatting(text.toLowerCase().match(dateRegex)[0]);
      const hour = text.toLowerCase().match(hourRegex);
      // if (!date || !hour) return null;
      // eslint-disable-next-line no-param-reassign
      if (date && hour) row.isDateTimeTBA = [{ text: '0' }];
      return `${date} ${hour?.[0]}`;
    },
    isPublicPurchase: (text) => {
      const wordsToBuy = ['disponible', 'agotado', 'compra', 'comprar'];

      return !!wordsToBuy.find(word => text.toLowerCase().includes(word));
    },

    eventURL: (text) => {
      if (text.startsWith('https://www.puntoticket.com')) return text;

      return `https://www.puntoticket.com${text}`;
    },

    eventDateFromCalendar: (text, row) => {
      const json = JSON.parse(row.scriptData?.[0]?.text || '{}');
      const eventHours = row.eventHours?.[0]?.text;
      const scriptDate = json[text];
      if (scriptDate?.length > 1 && (row.eventDateFromCalendarDuplicate && row.eventHourCount?.[0]?.text === '2')) {
        // eslint-disable-next-line no-param-reassign
        row.eventDateTime = [{ text: `${scriptDate[1].Fecha}` }];
        // eslint-disable-next-line no-param-reassign
        row.isDateTimeTBA = [{ text: '0' }];
        // eslint-disable-next-line no-param-reassign
        row.isPublicPurchase = [{ text: true }];
        return;
      }

      if (scriptDate && !(row.eventDateFromCalendarDuplicate && row.eventHourCount?.[0]?.text === '2')) {
        // eslint-disable-next-line no-param-reassign
        row.eventDateTime = [{ text: `${scriptDate[0].Fecha}` }];
        // eslint-disable-next-line no-param-reassign
        row.isDateTimeTBA = [{ text: '0' }];
        // eslint-disable-next-line no-param-reassign
        row.isPublicPurchase = [{ text: true }];
        return;
      }

      // eslint-disable-next-line no-param-reassign
      row.eventDateTime = [{ text: `${text.split('-').reverse().join('-')} ${eventHours}` }];
      // eslint-disable-next-line no-param-reassign
      row.isDateTimeTBA = [{ text: '0' }];
      // eslint-disable-next-line no-param-reassign
      row.isPublicPurchase = [{ text: false }];
    },

    eventDateNavbar: (text, row) => {
      const dateRegex = /^((?! \d{1,2}:\d{2}).)*/;
      const hourRegex = /d{1,2}:d{2}/;
      let textDate = text;
      const dateFromButton = row.eventButtonDate?.[0]?.text;

      if (dateFromButton) textDate = dateFromButton;
      if (textDate.match(/\d{4}-\d{2}-\d{2}.\d{2}:\d{2}/)) return textDate;

      let date = dateFormatting(textDate.toLowerCase().match(dateRegex)[0]);
      if (!date) {
        textDate = text;
        date = dateFormatting(textDate.toLowerCase().match(dateRegex)[0]);
      }

      const hour = textDate.toLowerCase().match(hourRegex);
      // eslint-disable-next-line no-param-reassign
      row.eventDateTime = [{ text: `${date} ${hour?.[0] || row.eventHours?.[0]?.text}` }];
      // eslint-disable-next-line no-param-reassign
      row.isDateTimeTBA = [{ text: '0' }];
      return null;
    },

    dateFromCalendarGet: (text, row) => {
      // eslint-disable-next-line no-param-reassign
      row.eventDateTime = [{ text: `${text}` }];
      // eslint-disable-next-line no-param-reassign
      row.isDateTimeTBA = [{ text: '0' }];
    },

    disabledFromCalendarGet: (text, row) => {
      if (row.dateFromCalendarGet) {
        if (text === 'false') {
          // eslint-disable-next-line no-param-reassign
          row.isPublicPurchase = [{ text: true }];
          return;
        }
        // eslint-disable-next-line no-param-reassign
        row.isPublicPurchase = [{ text: false }];
      }
    },

    eventURLParent: (text, row) => {
      // eslint-disable-next-line no-param-reassign
      row.eventURL = [{ text }];
    },

  };

  const mappingFct = (header, arr, row) => arr.map(({ text, ...other }) => ({ text: mapping[header](text, row), ...other }));

  data.forEach(obj => obj.group.forEach(row => Object.keys(row).forEach((header) => {
    // eslint-disable-next-line no-param-reassign
    if (mapping[header]) row[header] = mappingFct(header, row[header], row);

    if (row.eventName?.[0]?.text === 'Valle de la Luna') {
      // eslint-disable-next-line no-param-reassign
      row = null;
    }
  })));

  return data;
};

module.exports = { cleanUp };
