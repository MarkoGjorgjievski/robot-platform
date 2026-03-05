/**
 *
 * @param {ImportIO.Group[]} data
 * @returns {ImportIO.Group[]}
 */
const cleanUp = (data) => {
  const mapping = {
    eventTime: text => text.match(/(\d{2}:\d{2}:\d{2})/)?.[1],
    eventDate: text => text.match(/(\d{4}-\d{2}-\d{2})/)?.[1],
    venueAddress: text => text.split('\n')[0],
    venueAmenities: (_, row) => row.venueAmenities.map(({ text }) => text).join(','),
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
  };

  const mappingFct = (header, arr, row) => [...arr.map(({ text, ...other }) => ({ text: mapping[header](text, row), ...other }))];

  data.forEach(obj => obj.group.forEach((row) => {
    Object.keys(row).forEach((header) => {
      if (mapping[header]) {
        const transformedValues = mappingFct(header, row[header], row);
        // eslint-disable-next-line no-param-reassign
        row[header] = transformedValues;
      }
    });
  }));
  return data;
};
module.exports = { cleanUp };
