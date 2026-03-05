/* eslint-disable no-param-reassign */
/**
 *
 * @param {ImportIO.Group[]} data
 * @returns {ImportIO.Group[]}
 */
const cleanUp = (data) => {
  const mapping = {
    Program_Director_Full_Name: (text, row) => { // Ryan J Wallace MD, MPH, MH
      const [name, ...credentials] = text.split(', ');
      const firstCred = name.split(' ').pop();
      credentials.unshift(firstCred);
      const firstName = name.split(' ')[0];
      row.Program_Director_First_Name = [{ text: firstName }];
      const lastName = name.split(' ')[name.split(' ').length - 2];
      row.Program_Director_Last_Name = [{ text: lastName }];
      const middleName = name.split(' ').slice(1, -2);
      row.Program_Director_Middle_Name = [{ text: middleName.join(' ') }];
      row.Program_Director_Credentials = [{ text: credentials.join(', ') }];

      return text;
    },
    Program_Coordinator_Full_Name: (text, row) => { // Ryan J Wallace MD, MPH, MH but can not have accreditation
      const [name, ...credentials] = text.split(', ');
      const firstCred = name.split(' ').pop();
      if (firstCred.length <= 3 && name.split(' ').length > 2) {
        credentials.unshift(firstCred);
        const firstName = name.split(' ')[0];
        row.Program_Coordinator_First_Name = [{ text: firstName }];
        const lastName = name.split(' ')[name.split(' ').length - 2];
        row.Program_Coordinator_Last_Name = [{ text: lastName }];
        const middleName = name.split(' ').slice(1, -2);
        row.Program_Coordinator_Middle_Name = [{ text: middleName.join(' ') }];
        row.Program_Coordinator_Credentials = [{ text: credentials.join(', ') ?? '' }];
      } else {
        const firstName = name.split(' ')[0];
        row.Program_Coordinator_First_Name = [{ text: firstName }];
        const lastName = name.split(' ')[name.split(' ').length - 1];
        row.Program_Coordinator_Last_Name = [{ text: lastName }];
        const middleName = name.split(' ').slice(1, -1);
        row.Program_Coordinator_Middle_Name = [{ text: middleName.join(' ') }];
      }

      return text;
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
