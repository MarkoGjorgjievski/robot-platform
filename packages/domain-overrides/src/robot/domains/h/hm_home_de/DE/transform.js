/* eslint-disable no-param-reassign
*/
/**
 *
 * @param {ImportIO.Group[]} data
 * @returns {ImportIO.Group[]}
 */

const cleanUp = (data) => {
  const mapping = {
    dimensions_tmp: (text, row) => {
      text = text.replace(/,/g, '.');
      const format1 = text.match(/(L\d+\SH\d+\SW\d+)/g)?.[0];
      const format2 = text.match(/((\d+\.\d+)|(\d+))x((\d+\.\d+)|(\d+))x((\d+\.\d+)|(\d+))/g)?.[0];
      const format3 = text.match(/([D,L]\d+\S[H,W]\d+(?= ))/g)?.[0];
      const format4 = text.match(/(H ((\d+.\d+)|(\d+)) cm x B ((\d+.\d+)|(\d+)) cm x T ((\d+.\d+)|(\d+))(?= cm))/g)?.[0];
      const format5 = text.match(/L((\d+.\d+)|(\d+))\sx\sB((\d+.\d+)|(\d+))\sx\sH((\d+.\d+)|(\d+))/g)?.[0];
      const format6 = text.match(/L(H ((\d+.\d+)|(\d+)) x B ((\d+.\d+)|(\d+)) x T ((\d+.\d+)|(\d+))(?= cm))/g)?.[0];
      let length; let width; let diameter; let height;

      if (text.includes('Höhe')) {
        height = text.match(/((?<=Höhe: )|(?<=Höhe.)|(?<=Höhe ca. )|(?<=Höhe total )|(?<=Höhe total. )|(?<=Höhen )|(?<=Höhe von )|(?<=Höhe einschließlich Deckel )|(?<=Höhe der Sitzfläche.))((\d+\.\d{1,2})|(\d+))/g)?.[0];
        if (height !== undefined) row.height = [{ text: `${height}` }];
      }

      if (text.includes('Sitzhöhe')) {
        height = text.match(/(?<=Sitzhöhe beträgt.)((\d+\.\d{1,2})|(\d+))/g)?.[0];
        if (height !== undefined) row.height = [{ text: `${height}` }];
      }

      if (text.includes('Gesamthöhe')) {
        height = text.match(/((?<=Gesamthöhe.)|(?<=Gesamthöhe der Stühle.)|(?<=Gesamthöhe des Stuhls.))((\d+\.\d{1,2})|(\d+))/g)?.[0];
        if (height !== undefined) row.height = [{ text: `${height}` }];
      }

      if (text.includes('größe')) {
        height = text.match(/(?<=größe: )|((\d+\.\d{1,2})|(\d+))/g)?.[0];
        if (height !== undefined) row.height = [{ text: `${height}` }];
      }

      if (text.includes('Breite')) {
        width = text.match(/((?<=Breite: )|(?<=Breite.)|(?<=Breite ca. )|(?<=Breite total. )|(?<=Breite total ))((\d+\.\d{1,2})|(\d+))/g)?.[0];
        if (width !== undefined) row.width = [{ text: `${width}` }];
      }

      if (text.includes('Gesamtbreite')) {
        width = text.match(/(?<=Gesamtbreite.)((\d+\.\d{1,2})|(\d+))/g)?.[0];
        if (width !== undefined) row.width = [{ text: `${width}` }];
      }

      if (text.includes('breit')) {
        width = text.match(/(?<=breit. )((\d+\.\d{1,2})|(\d+))/g)?.[0];
        if (width !== undefined) row.width = [{ text: `${width}` }];
      }

      if (text.includes('Sitzbreite')) {
        width = text.match(/(?<=Sitzbreite.)((\d+\.\d{1,2})|(\d+))/g)?.[0];
        if (width !== undefined) row.width = [{ text: `${width}` }];
      }

      if (text.includes('Tiefe')) {
        length = text.match(/((?<=Tiefe: )|(?<=Tiefe.)|(?<=Tiefe ca. )|(?<=Tiefe total )|(?<=Tiefe total. ))((\d+\.\d{1,2})|(\d+))/g)?.[0];
        if (length !== undefined) row.length = [{ text: `${length}` }];
      }

      if (text.includes('tief')) {
        length = text.match(/(?<=tief. )((\d+\.\d{1,2})|(\d+))/g)?.[0];
        if (length !== undefined) row.length = [{ text: `${length}` }];
      }

      if (text.includes('Sitztiefe')) {
        length = text.match(/(?<=Sitztiefe ist.)((\d+\.\d{1,2})|(\d+))/g)?.[0];
        if (length !== undefined) row.length = [{ text: `${length}` }];
      }

      if (text.includes('Länge')) {
        length = text.match(/((?<=Länge: )|(?<=Länge.)|(?<=Länge ca. )|(?<=Länge total. )|(?<=Länge total )|(?<=Kabellänge ))((\d+\.\d{1,2})|(\d+))/g)?.[0];
        if (length !== undefined) row.length = [{ text: `${length}` }];
      }

      if (text.includes('Durchmesser')) {
        diameter = text.match(/((?<=Durchmesser: )|(?<=Durchmesser.)|(?<=Durchmesser ca. )|(?<=Durchmesser total. )|(?<=Durchmesser total )|(?<=Durchmesser von )|(?<=Durchmesser der Sitzfläche.))((\d+\.\d{1,2})|(\d+))/g)?.[0];
        if (diameter !== undefined) row.diameter = [{ text: `${diameter}` }];
      }

      if (text.includes('Sitzdurchmesser')) {
        diameter = text.match(/(?<=Sitzdurchmesser.)((\d+\.\d{1,2})|(\d+))/g)?.[0];
        if (diameter !== undefined) row.diameter = [{ text: `${diameter}` }];
      }

      if (text.includes('Breiteste')) {
        diameter = text.match(/(?<=Breiteste Stelle ca. )((\d+\.\d{1,2})|(\d+))/g)?.[0];
        if (diameter !== undefined) row.diameter = [{ text: `${diameter}` }];
      }

      if (format1 !== undefined) {
        height = text.match(/(?<=L)((\d+\.\d+(?=x))|(\d+(?=x)))/g)?.[0];
        width = text.match(/(?<=xH)((\d+\.\d+(?=x))|(\d+(?=x)))/g)?.[0];
        length = text.match(/(?<=xW)((\d+\.\d+)|(\d+(?= )))/g)?.[0];
        if (height !== undefined) row.height = [{ text: `${height}` }];
        if (width !== undefined) row.width = [{ text: `${width}` }];
        if (length !== undefined) row.length = [{ text: `${length}` }];
      }

      if (format2 !== undefined && (height === undefined || width === undefined || length === undefined)) {
        height = text.match(/(?<=\s)((\d+\.\d+)|(\d+))(?=x)/g)?.[0];
        width = text.match(/(?<=x)((\d+\.\d+)|(\d+))(?=x)/g)?.[0];
        length = text.match(/(?<=x)((\d+\.\d+)|(\d+))(?=\s)/g)?.[0];
        if (height !== undefined) row.height = [{ text: `${height}` }];
        if (width !== undefined) row.width = [{ text: `${width}` }];
        if (length !== undefined) row.length = [{ text: `${length}` }];
      }

      if (format3 !== undefined) {
        height = text.match(/((?<=x[H,W])((\d+\.\d+)|(\d+)(?= )))/g)?.[0];
        const widthlenght = text.match(/((?<=[L,D])((\d+\.\d+(?=x))|(\d+(?=x))(?=x[H,W])))/g)?.[0];
        if (height !== undefined) row.height = [{ text: `${height}` }];
        if (widthlenght !== undefined) row.width = [{ text: `${widthlenght}` }];
        if (widthlenght !== undefined) row.length = [{ text: `${widthlenght}` }];
      }

      if (format4 !== undefined) {
        height = text.match(/(?<=H )((\d+\.\d+)|(\d+))(?= cm)/g)?.[0];
        width = text.match(/(?<=B )((\d+\.\d+)|(\d+))(?= cm)/g)?.[1];
        length = text.match(/(?<=T )((\d+\.\d+)|(\d+))(?= cm)/g)?.[2];
        if (height !== undefined) row.height = [{ text: `${height}` }];
        if (width !== undefined) row.width = [{ text: `${width}` }];
        if (length !== undefined) row.length = [{ text: `${length}` }];
      }

      if (format5 !== undefined) {
        length = text.match(/(?<= L)((\d+\.\d+(?= x))|(\d+(?= x)))/g)?.[0];
        width = text.match(/(?<=x B)((\d+\.\d+(?= x))|(\d+(?= x)))/g)?.[0];
        height = text.match(/(?<=x H)((\d+\.\d+(?= cm))|(\d+(?= cm)))/g)?.[0];
        if (height !== undefined) row.height = [{ text: `${height}` }];
        if (width !== undefined) row.width = [{ text: `${width}` }];
        if (length !== undefined) row.length = [{ text: `${length}` }];
      }

      if (format6 !== undefined) {
        height = text.match(/(?<=H )((\d+\.\d+)|(\d+))(?= x)/g)?.[0];
        width = text.match(/(?<=B )((\d+\.\d+)|(\d+))(?= x)/g)?.[1];
        length = text.match(/(?<=T )((\d+\.\d+)|(\d+))(?= cm)/g)?.[2];
        if (height !== undefined) row.height = [{ text: `${height}` }];
        if (width !== undefined) row.width = [{ text: `${width}` }];
        if (length !== undefined) row.length = [{ text: `${length}` }];
      }

      return text;
    },
    size_tmp: (text, row) => {
      text = text.replace(/,/g, '.');
      const format1 = text.match(/(\d+X\d+X\d+)/g)?.[0];
      const format2 = text.match(/(\d+X\d+)/g)?.[0];
      if (format1 !== undefined) {
        const height = text.match(/(\d+\.\d{1,2})|(\d+)/g)?.[0];
        const width = text.match(/(?<=X)((\d+\.\d{1,2})|(\d+))/g)?.[0];
        const length = text.match(/(?<=X)((\d+\.\d{1,2})|(\d+))/g)?.[1];
        if (height !== undefined) row.height = [{ text: `${height}` }];
        if (width !== undefined) row.width = [{ text: `${width}` }];
        if (length !== undefined) row.length = [{ text: `${length}` }];
      } else if (format2 !== undefined) {
        const length = text.match(/(\d+\.\d{1,2})|(\d+)/g)?.[0];
        const width = text.match(/(?<=X)((\d+\.\d{1,2})|(\d+))/g)?.[0];
        if (width !== undefined) row.width = [{ text: `${width}` }];
        if (length !== undefined) row.length = [{ text: `${length}` }];
      }
      return text;
    },
    weight_raw: (text) => {
      text = text.replace(/,/g, '.');
      text = text.replace(' ', '');
      return text;
    },
    offer_price: (text) => {
      text = text.replace(/,/g, '.');
      text = text.replace(' ', '');
      return text;
    },
    original_price: (text) => {
      text = text.replace(/,/g, '.');
      text = text.replace(' ', '');
      return text;
    },
    materials_raw: (text, row) => {
      text = text.replace(/\n/g, '');
      text = text.replace(/:/g, ': ');
      text = text.split('\n');
      row.materials = text.map(el => ({ text: el }));
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
