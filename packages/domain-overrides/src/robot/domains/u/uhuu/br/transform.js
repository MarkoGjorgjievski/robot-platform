/* eslint-disable no-param-reassign
*/
/**
 *
 * @param {ImportIO.Group[]} data
 * @returns {ImportIO.Group[]}
 */
const cleanUp = (data) => {
  const mapping = {
    eventDate: (text) => {
      const now = new Date();
      const newDate = text.split('/').reverse().join('/');
      const month = newDate.match(/\d{2}/)[0];
      let year;

      if (month >= now.getMonth() + 1) {
        year = now.getFullYear();
      } else {
        year = now.getFullYear() + 1;
      }

      return `${year}/${newDate}`;
    },
    eventDateTitle: (text, row) => {
      if (!row.eventDate) {
        const now = new Date();
        let day = text.match(/\d{2}(?=\/)/)[0];
        day = day.replace('/', '');
        let month = text.match(/(?<=\/)\d{2}\//)[0];
        month = month.replace('/', '');
        let year;

        if (month >= now.getMonth() + 1) {
          year = now.getFullYear();
        } else {
          year = now.getFullYear() + 1;
        }

        row.eventDate = [{ text: `${year}/${month}/${day}` }];
        // row.eventDate = [{ text: `${text.split('/').reverse().join('/')}` }];
        // row.eventDate = [{ text }];
      }
    },
    eventTimeTitle: (text, row) => {
      if (!row.eventTime?.[0]?.text) row.eventTime = [{ text }];
      return text;
    },
  };

  const mappingFct = (header, arr, row) => arr.map(({ text, ...other }) => ({ text: mapping[header](text, row), ...other }));

  data.forEach(obj => obj.group.forEach(row => Object.keys(row).forEach((header) => {
    // eslint-disable-next-line no-param-reassign
    if (mapping[header]) row[header] = mappingFct(header, row[header], row);
  })));

  return data;
};

module.exports = { cleanUp };

// if (!row.eventDate?.[0]?.text) {
//   // Creating a Date object
//   const date = new Date(text);
//   // Getting the full year, month, and date
//   const year = date.getFullYear();
//   let month = date.getMonth() + 1; // Months are zero-based in JS, so add 1 to get the correct month
//   let day = date.getDate();

//   // Formatting month and day to always be two digits
//   // @ts-ignore
//   month = month.toString().padStart(2, '0');
//   // @ts-ignore
//   day = day.toString().padStart(2, '0');

//   // Creating the new formatted date string in YYYY/MM/DD format
//   row.eventDate = [{ text: `${year}/${month}/${day}` }];
// }
// return text;

// const dateFormatting = (dateToFormat) => {
//   const PtMonths = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
//   let date = dateToFormat;
//   let day;
//   let month;
//   let year;

//   date = date.replace('.', ' ');
//   date = date.replace('/', ' ');
//   date = date.replace('-', ' ');
//   date = date.replace('(', ' ');

//   date = date.replace(/\s+/g, ' ');
//   date = date.trim();
//   const words = date.split(' ');

//   words.map((x) => {
//     if (/^[0-9]{1,2}$/.test(x)) {
//       day = x;
//     } else if (/[0-9]{4}/.test(x)) {
//       year = x;
//     } else if (/[a-z]+/.test(x) && x.length >= 3) {
//       PtMonths.map((m) => {
//         if (m.startsWith(x)) {
//           month = PtMonths.indexOf(m) + 1;
//         }
//       });
//     }
//   });

//   if (year == null) {
//     year = new Date().getFullYear();
//   }

//   if (!month) return;

//   return `${year}/${month}/${day}`;
// };
