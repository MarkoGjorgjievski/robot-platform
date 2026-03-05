/**
 *
 * @param {ImportIO.Group[]} data
 * @returns {ImportIO.Group[]}
 */
const cleanUp = (data) => {
  const mapping = {
    onSaleDateTime: (date, row) => {
      const givenDate = new Date(date);
      givenDate.setHours(givenDate.getHours() - 1);

      // Format the date as "MM-DD-YYYY hh:MM"
      const month = String(givenDate.getMonth() + 1).padStart(2, '0');
      const day = String(givenDate.getDate()).padStart(2, '0');
      const year = givenDate.getFullYear();
      const hours = String(givenDate.getHours()).padStart(2, '0');
      const minutes = String(givenDate.getMinutes()).padStart(2, '0');
      // eslint-disable-next-line no-param-reassign
      row.onSaleDate = [{ text: `${month}-${day}-${year} ${hours}:${minutes}` }];
      return `${month}-${day}-${year} ${hours}:${minutes}`;
    },
    eventDateTime: (dateStr) => {
      const [datePart, timePart] = dateStr.split(' ');
      const [date, month, year] = datePart.split('/').map(Number);
      const [hours, minutes, seconds] = timePart.split(':').map(Number);

      const eventDate = new Date(year, month - 1, date, hours, minutes, seconds);

      return eventDate.toISOString();
    },
  };

  const mappingFct = (header, arr, row) => arr.map(({ text, ...other }) => {
    if (mapping[header]) {
      // eslint-disable-next-line no-param-reassign
      text = mapping[header](text, row);
    }
    return { text, ...other };
  });

  data.forEach(obj => obj.group.forEach(row => Object.keys(row).forEach((header) => {
    // eslint-disable-next-line no-param-reassign
    if (mapping[header]) row[header] = mappingFct(header, row[header], row);
  })));

  return data;
};

module.exports = { cleanUp };
