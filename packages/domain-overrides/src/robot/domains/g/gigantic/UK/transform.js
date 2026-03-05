/**
 *
 * @param {ImportIO.Group[]} data
 * @returns {ImportIO.Group[]}
 */
const cleanUp = (data) => {
  const mapping = {
    eventNotesJQ: (text, row) => {
      // eslint-disable-next-line no-param-reassign
      row.eventNotes = [...(row.eventNotes || []), ...row.eventNotesJQ];
    },
    eventNoteInfos: (text, row) => {
      // eslint-disable-next-line no-param-reassign
      row.eventNotes = [...(row.eventNotes || []), ...row.eventNoteInfos];
    },
    onSaleDate: (text) => {
      if (!text || text === 'undefined') return '';
      console.log(text);
      // Parse the extracted date and time
      const dateTime = new Date(parseInt(text, 10));
      // Format the date and time as MM/DD/YYYY hh:MM
      const formattedDateTime = `${(dateTime.getMonth() + 1).toString().padStart(2, '0')}/${dateTime.getDate().toString().padStart(2, '0')}/${dateTime.getFullYear()} ${dateTime.getHours().toString().padStart(2, '0')}:${dateTime.getMinutes().toString().padStart(2, '0')}`;

      console.log(formattedDateTime);
      return formattedDateTime;
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
