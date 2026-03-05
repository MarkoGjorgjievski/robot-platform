/* eslint-disable no-param-reassign */
/**
 *
 * @param {ImportIO.Group[]} data
 * @returns {ImportIO.Group[]}
 */
const cleanUp = (data) => {
  let isEventURL = false;

  const incrementYearIfDateInThePast = (date) => {
    const now = new Date();
    const dateObject = new Date(date);
    if (dateObject < now) {
      dateObject.setFullYear(dateObject.getFullYear() + 1);
    }
    return dateObject;
  };

  data.forEach(({ group }) => {
    group.forEach((row) => {
      if ('eventURL' in row) {
        isEventURL = true;
        row.eventURL = row.eventURL.filter(
          ({ text }) => (text.match(/\//g) || []).length > 3,
        );
      }
    });
  });

  if (!isEventURL) {
    const mapping = {
      eventDateTime: (text, row) => {
        const months = {
          ene: 0,
          feb: 1,
          mar: 2,
          abr: 3,
          may: 4,
          jun: 5,
          jul: 6,
          ago: 7,
          sep: 8,
          oct: 9,
          nov: 10,
          dic: 11,
          enero: 0,
          febrero: 1,
          marzo: 2,
          abril: 3,
          mayo: 4,
          junio: 5,
          julio: 6,
          agosto: 7,
          septiembre: 8,
          octubre: 9,
          noviembre: 10,
          diciembre: 11,
        };

        const newParseDateString = (dateString) => {
          const regex = /(?<day>\d{1,2})\s+(?:de)?\s?(?<month>\w+\.?)?(?: (?<hour>\d{1,2})(:(?<minutes>\d{2}))?)?/i;

          const match = regex.exec(dateString);

          if (!match) return undefined;

          const { day, month, hour, minutes } = match.groups;
          const monthIndex = months[month.toLowerCase().replace('.', '')];

          const monthNameInvalid = monthIndex === undefined;
          if (monthNameInvalid) return undefined;

          let finalHour = 15;
          if (!hour) {
            row.isDateTimeTBA = [{ text: '1' }];
          } else {
            finalHour = parseInt(hour, 10);
          }

          const dateUTC = new Date(
            Date.UTC(
              new Date().getFullYear(),
              monthIndex,
              parseInt(day, 10),
              finalHour,
              parseInt(minutes, 10) || 0,
            ),
          );

          const dateObject = incrementYearIfDateInThePast(dateUTC);
          return dateObject.toISOString();
        };

        if (text.toLowerCase().includes('abono completo')) {
          row.isPublicPurchase = [{ text: '0' }];
        }

        return newParseDateString(text);
      },
      jsonEventDate: (text, row) => {
        // from "2024-03-14T21:30:00-03:00" replace "-03:00" to "-00:00"
        const removedTimezone = text.replace(/(\+|-)\d{2}:\d{2}/, '-00:00');

        if (text) {
          row.eventDateTime = [
            { text: new Date(removedTimezone).toISOString() },
          ];
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

    // filter out records with no dateTime
    data.forEach((obj) => {
      obj.group = obj.group.filter((row) => {
        // if is multipage extraction, do not filter out
        if (!row.isSinglePageExtraction) return true;
        // if it is single page extraction - get the event date value
        const eventDateTime = row.eventDateTime?.[0]?.text;
        return eventDateTime?.length > 0;
      });

      // update rows count
      obj.rows = obj.group.length;
    });

    return data;
  }

  data.forEach((obj) => {
    if ('group' in obj) {
      obj.group = obj.group.filter(row => (row.eventURL || []).length > 0);
      obj.rows = obj.group.length;
    }
  });

  return data.filter(({ rows }) => rows > 0);
};

module.exports = { cleanUp };
