/**
 *
 * @param {ImportIO.Group[]} data
 * @returns {ImportIO.Group[]}
 */
const cleanUp = (data) => {
  const mapping = {
    eventDateTime: (text, row) => {
      const eventTimeValue = row.eventTime ? row.eventTime[0].text : undefined;
      const eventTitleTimeValue = row.eventTitleTimeText
        ? row.eventTitleTimeText[0].text
        : undefined;

      const eventDateValue = row.eventDate ? row.eventDate[0].text : undefined;
      const eventStartDateValue = row.eventStartDate
        ? row.eventStartDate[0].text
        : undefined;

      const effectiveTime = eventTimeValue || eventTitleTimeValue;
      const effectiveDate = eventDateValue || eventStartDateValue;
      return `${effectiveDate} ${effectiveTime}`;
    },
  };

  const mappingFct = (header, arr, row) => [
    ...arr.map(({ text, ...other }) => ({
      text: mapping[header](text, row),
      ...other,
    })),
  ];

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
