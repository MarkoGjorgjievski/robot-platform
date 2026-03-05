/* eslint-disable no-param-reassign */

/**
 *
 * @param {ImportIO.Group[]} data
 * @returns {ImportIO.Group[]}
 */
const transformation = (data) => {
  const urlFormatFix = function (row, baseUrl, fields) {
    fields.forEach((field) => {
      if (row[field]) {
        const fieldUrl = row[field][0].text;
        if (!fieldUrl.includes('ticketmaster')) {
          row[field] = [{ text: baseUrl + fieldUrl }];
        }
      }
    });
  };

  const clean = text => text
    .toString()
    .replace(/\r\n|\r|\n/g, ' ')
    .replace(/&amp;nbsp;/g, ' ')
    .replace(/&amp;#160/g, ' ')
    .replace(/\u00A0/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .replace(/"\s{1,}/g, '"')
    .replace(/\s{1,}"/g, '"')
    .replace(/^ +| +$|( )+/g, ' ')
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x1F]/g, '')
    .replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, ' ');

  data.forEach(({ group }) => {
    group.forEach((row) => {
      const invalidDate = 'Invalid Date';
      if (row.eventDateStart || row.eventDate || row.backupEventTime) {
        let bestEventTime;
        if (row.eventDate) {
          bestEventTime = row.eventDate[0].text;
        } else if (
          row.eventDateStart?.[0]?.text
          && row.eventDateStart?.[0]?.text.includes(':')
        ) {
          bestEventTime = row.eventDateStart[0].text;
        } else {
          bestEventTime = row.backupEventTime[0].text;
        }
        console.log({ bestEventTime });
        const date = new Date(bestEventTime);
        if (date.toString() === invalidDate) {
          delete row.eventTime;
        } else {
          if (row.eventTimeSlotFromPage) {
            const timeSlotTextRaw = row.eventTimeSlotFromPage[0].text;
            const isPM = timeSlotTextRaw.includes('PM');
            const timeSlotText = timeSlotTextRaw.match(/\d+:\d+/g)?.[0];
            if (timeSlotText) {
              const timeSlot = timeSlotText
                .split(':')
                .map(time => Number(time));
              const [hours12, minutes] = timeSlot;
              let hours = hours12;
              if (isPM && hours !== 12) hours += 12;
              console.log(`Setting from timeslot: ${hours}:${minutes}`);
              date.setHours(hours);
              date.setMinutes(minutes);
            }
          }
          const formattedTime = [date.getHours(), date.getMinutes()]
            .map(el => el.toString().padStart(2, '0'))
            .join(':');

          row.eventTimeTxt = [{ text: formattedTime }];
          row.EventTimeIn24HrTxt = row.eventTimeTxt;
          row.eventDateTime = [{ text: date }];
          row.eventDateTimeRaw = row.eventDateTime;
          row.eventDate = row.eventDateTimeRaw;
        }
      }

      if (row.ticketsOnSaleDateTimeRaw) {
        const onSaleDate = new Date(row.ticketsOnSaleDateTimeRaw[0].text);
        if (onSaleDate.toString() === invalidDate) {
          delete row.ticketsOnSaleDateTimeRaw;
        } else {
          if (row.isPublicPurchaseRaw) {
            const today = new Date();
            const isPublicPurchase = row.isPublicPurchaseRaw[0].text;
            if (isPublicPurchase === 'General Onsale' && onSaleDate > today) {
              row.isPublicPurchase = [{ text: 'FALSE' }];
            }
          }

          row.ticketsOnSaleDate = [{ text: onSaleDate }];
          row.ticketsOnSaleDateTime = row.ticketsOnSaleDate;
          row.ticketsOnSaleDateTimeRaw = row.ticketsOnSaleDateTime;
        }
      }

      if (row.ticketsPreSaleDateTimeRaw) {
        const date = new Date(row.ticketsPreSaleDateTimeRaw[0].text);
        if (date.toString() === invalidDate) {
          delete row.ticketsPreSaleDateTimeRaw;
        } else {
          row.ticketsPreSaleDate = [{ text: date }];
          row.ticketsPreSaleDatTime = row.ticketsPreSaleDate;
        }
      }

      if (row.currentCountryCode && row.venueCountryCode) {
        const venueCode = row.venueCountryCode[0].text;
        const countryCode = row.currentCountryCode[0].text;
        if (!countryCode.includes(venueCode.toLowerCase())) {
          row.isInternational = [{ text: 'TRUE' }];
          row.internationalEventUrl = row.eventURL;
        }
      }

      if (!row.venueCountryCode) {
        delete row.isInternational;
      }

      if (row.eventURL) {
        const baseUrl = row.eventURL[0].text.match(
          /^(?:[^/]*\/){2}[^/]+/g,
        )?.[0];

        urlFormatFix(row, baseUrl, ['eventCategoryURL', 'eventSubcategoryURL', 'eventSeriesURL']);
      }

      if (row.venueRawText || row.venueRawScript) {
        row.venueRaw = [{ text: row.venueRawText?.[0]?.text || row.venueRawScript?.[0]?.text }];
      }
    });
  });

  data.forEach((obj) => {
    obj.group.forEach((row) => {
      Object.keys(row).forEach((header) => {
        row[header].forEach((el) => {
          el.text = clean(el.text);
        });
      });
    });
  });
  return data;
};

module.exports = { transformation };
