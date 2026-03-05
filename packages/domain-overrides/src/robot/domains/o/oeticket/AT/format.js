/* eslint-disable sonarjs/no-duplicate-string */
/* eslint-disable sonarjs/no-collapsible-if */
/* eslint-disable eqeqeq */
/* eslint-disable no-restricted-syntax */
/* eslint-disable no-param-reassign */
/**
 *
 * @param {ImportIO.Group[]} data
 * @returns {ImportIO.Group[]}
 */
const transform = (data) => {
  const cleanUp = () => {
    const clean = text => text.toString()
      .replace(/\r\n|\r|\n/g, ' ')
      .replace(/&amp;nbsp;/g, ' ')
      .replace(/&amp;#160/g, ' ')
      .replace(/\u00A0/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .replace(/"\s{1,}/g, '"')
    // .replace(/\s{1,}"/g, '"')
      .replace(/^ +| +$|( )+/g, ' ')
    // eslint-disable-next-line no-control-regex
      .replace(/[\x00-\x1F]/g, '')
      .replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, ' ');
    data.forEach(obj => obj.group.forEach(row => Object.keys(row).forEach(header => row[header].forEach((el) => {
      el.text = clean(el.text);
    }))));
    return data;
  };
  for (const { group } of data) {
    for (const row of group) {
      if (row.venueAddress1) {
        let vAdd1 = '';
        let vAdd2 = '';
        row.venueAddress.forEach((item) => {
          if (item.text.includes(', ')) {
            vAdd1 = item.text.slice(0, item.text.lastIndexOf(','));
            vAdd2 = item.text.split(', ').pop();
          } else if (item.text != ',') {
            vAdd1 = item.text;
          }
        });
        row.venueAddress = [{ text: vAdd1 }];
        row.venueAddress2 = [{ text: vAdd2 }];
      }
      if (row.venueCity) {
        let info = '';
        row.venueCity.forEach((item) => {
          if (item.text.includes(', ')) {
            info = item.text.split(', ').pop();
          } else {
            info = item.text;
          }
        });
        if (info.match(/\d+/g)) {
          info = info.substring(info.indexOf(' ') + 1);
        }
        row.venueCity = [{ text: info.replace(/\\/g, '').trim() }];
      }
      if (row.eventDate) {
        let info = '';
        row.eventDate.forEach((item) => {
          if (item.text.includes('T')) {
            info = item.text.split('T').shift();
          }
        });
        row.eventDate = [{ text: info }];
      }
      let eventDateTime = '';
      if (row.eventDateTime) {
        let info = '';
        row.eventDateTime.forEach((item) => {
          if (item.text.includes('+')) {
            info = item.text.split('+').shift();
            info = `${info}Z`;
          } else {
            info = item.text;
          }
          eventDateTime = info;
        });
        row.eventDateTime = [{ text: info }];
      }
      if (row.eventTimeTxt) {
        let info = '';
        row.eventTimeTxt.forEach((item) => {
          if (item.text.includes(', ')) {
            info = item.text.split(', ').pop();
            if (info.includes(' ')) {
              info = info.split(' ').shift();
            }
          }
        });
        if (info == '' || info.includes('.') || info.includes('-') || info.includes('/')) {
          if (eventDateTime != '') {
            if (eventDateTime.includes('T')) {
              info = eventDateTime.split('T').pop().slice(0, 5);
            }
          }
        }
        row.eventTimeTxt = [{ text: info.replace('dummy', '').trim() }];
        row.EventTimeIn24HrTxt = [{ text: info.replace('dummy', '').trim() }];
      }
      if (row.eventName) {
        let info = '';
        row.eventName.forEach((item) => {
          info = item.text.replace(/\\/g, '').trim();
        });
        row.eventName = [{ text: info.slice(0, -2) }];
      }
      if (row.venueName) {
        let info = '';
        row.venueName.forEach((item) => {
          info = item.text.replace(/\\/g, '').slice(0, -2);
        });
        row.venueName = [{ text: info }];
      }
      if (row.venueRaw) {
        let info = '';
        row.venueRaw.forEach((item) => {
          info = item.text.replace(/\\/g, '').slice(0, -2);
        });
        row.venueRaw = [{ text: info }];
      }
      if (row.ticketsPrices) {
        let info = '';
        row.ticketsPrices.forEach((item) => {
          info = `${item.text} €`;
        });
        row.ticketsPrices = [{ text: info.replace('Køb billetter €', '') }];
      }
      if (row.ticketsMinPrice) {
        let info = '';
        row.ticketsMinPrice.forEach((item) => {
          info = `${item.text} €`;
        });
        row.ticketsMinPrice = [{ text: info.replace('Køb billetter €', '') }];
      }
      if (row.ticketsMaxPrice) {
        let info = '';
        row.ticketsMaxPrice.forEach((item) => {
          info = `${item.text} €`;
        });
        row.ticketsMaxPrice = [{ text: info.replace('Køb billetter €', '') }];
      }
      if (row.isPublicPurchase) {
        row.isPublicPurchase.forEach((item) => {
          item.text = item.text.trim();
        });
      }
      if (row.isPublicPurchaseRaw) {
        row.isPublicPurchaseRaw.forEach((item) => {
          item.text = item.text.trim();
        });
      }
      let eventURL = '';
      if (row.eventURL) {
        row.eventURL.forEach((item) => {
          item.text = item.text.trim();
          eventURL = item.text;
        });
      }
      let venueCountryCode = '';
      if (row.venueCountryCode) {
        row.venueCountryCode.forEach((item) => {
          item.text = item.text.trim();
          venueCountryCode = item.text;
        });
      }
      if (row.postalCode) {
        let venuePostalCodeLength = 0;
        row.postalCode.forEach((item) => {
          item.text = item.text.trim();
          venuePostalCodeLength = item.text.length;
        });
        if (venuePostalCodeLength == 5 && venueCountryCode == '') {
          row.venueCountryCode = [{ text: 'DE' }];
          row.isInternational = [{ text: '1' }];
          row.internationalEventUrl = [{ text: eventURL }];
        }
      }
    }
  }
  return cleanUp();
};

module.exports = { transform };
