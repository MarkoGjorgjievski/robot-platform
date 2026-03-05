/* eslint-disable prefer-template */
/* eslint-disable no-param-reassign */
// @ts-nocheck
/**
 *
 * @param {ImportIO.Group[]} data
 * @returns {ImportIO.Group[]}
 */
const cleanUp = (data) => {
  // for (let group  of data) {
  //   console.log("#####################################")
  //   let varr = false;
  //   for (let row of group.group) {
  //     try {
  //       if (row.eventPrice) {
  //         console.log("********")
  //         if (row.eventPrice[0].text == "£0.00") {
  //           varr = true;
  //           console.log("if price 0 passed  "+varr)
  //           // delete group[0]
  //         }
  //       }
  //     } catch (e) {
  //       console.log("error is" + e);
  //     }
  //   }
  //   if (varr) delete group.group;
  // }
  const dateString = (text) => {
    const dateRaw = new Date(
      text.replace(/th/g, '').replace(/st/g, '').replace(/rd/g, ''),
    );
    const day = ('0' + dateRaw.getUTCDate()).slice(-2);
    const month = ('0' + (dateRaw.getUTCMonth() + 1)).slice(-2);
    const year = dateRaw.getUTCFullYear();
    return `${year}-${month}-${day}`;
  };
  const mapping = {
    eventDateTimeJQ: (text, row) => {
      if (text) {
        row.eventDate = [{ text: row.eventDateTimeJQ[0].text?.split('T')[0] }];
        row.eventTime = [{ text: row.eventDateTimeJQ[0].text?.split('T')[1] }];
      }
    },
    eventDateGlobal: (text, row) => {
      if (!row.eventDateRow && row.eventDateGlobal && text) {
        row.eventDate = [{ text: dateString(row.eventDateGlobal[0].text) }];
      }
    },
    eventDateRow: (text, row) => {
      if (text) {
        row.eventDate = [{ text: dateString(text) }];
      }
    },
    postalCodeJQ: (text, row) => {
      if (row.postalCodeJQ[0].text) {
        row.postalCode = [
          {
            text: text.match(/([A-Z0-9]{2,4} ?[A-Z0-9]{2,4})\|?/)
              ? text.match(/([A-Z0-9]{2,4} ?[A-Z0-9]{2,4})\|?/)[1]
              : '',
          },
        ];
      }
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
