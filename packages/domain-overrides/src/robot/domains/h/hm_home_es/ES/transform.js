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
      text = text.replace(',', '.');

      const format1 = text.match(/(L\d*\SH\d*\SW\d*)/g)?.[0];
      const format2 = text.match(/([D,L]\d*\S[H,W]\d*(?= ))/g)?.[0];
      if (text.includes('Alto')) {
        const height = text.match(/((?<=Alto )|(?<=Alto.)|(?<=Alto aprox. )|(?<=Alto total )|(?<=Alto total aprox. )|(?<=Alto de la maceta ))((\d*\.\d{1,2})|(\d*))/g)?.[0];
        if (height !== undefined) row.height = [{ text: `${height}` }];
      }

      if (text.includes('Ancho')) {
        const width = text.match(/((?<=Ancho: )|(?<=Ancho.)|(?<=Ancho total aprox. )|(?<=Ancho aprox. )|(?<=Ancho total ))((\d*\.\d{1,2})|(\d*))/g)?.[0];
        if (width !== undefined) row.width = [{ text: `${width}` }];
      }

      if (text.includes('Fondo')) {
        const length = text.match(/((?<=Fondo )|(?<=Fondo total aprox. )|(?<=Fondo de la silla )|(?<=Fondo total )|(?<=Fondo aprox. ))((\d*\.\d{1,2})|(\d*))/g)?.[0];
        if (length !== undefined) row.length = [{ text: `${length}` }];
      }

      if (text.includes('Largo')) {
        const length = text.match(/((?<=Largo: )|(?<=Largo.)|(?<=Largo )|(?<=Largo aprox. ))((\d*\.\d{1,2})|(\d*))/g)?.[0];
        if (length !== undefined) row.length = [{ text: `${length}` }];
      }

      if (text.includes('Profundidad')) {
        const length = text.match(/(?<=Profundidad )((\d*\.\d{1,2})|(\d*))/g)?.[0];
        if (length !== undefined) row.length = [{ text: `${length}` }];
      }

      if (text.includes('Profundo')) {
        const length = text.match(/(?<=Profundo )((\d*\.\d{1,2})|(\d*))/g)?.[0];
        if (length !== undefined) row.length = [{ text: `${length}` }];
      }

      if (text.includes('Diámetro')) {
        const diameter = text.match(/((?<=Diámetro )|(?<=Diámetro del asiento )|(?<=Diámetro del cuenco )|(?<=Diámetro del estante )|(?<=Diámetro del tablero )|(?<=Diámetro de la bandeja )|(?<=Diámetro superior ))((\d*\.\d{1,2})|(\d*))/g)?.[0];
        if (diameter !== undefined) row.diameter = [{ text: `${diameter}` }];
      }

      if (text.includes('Alto') && text.includes('Ancho')) {
        const height = text.match(/((?<=Alto )|(?<=Alto.)|(?<=Alto aprox. )|(?<=Alto total )|(?<=Alto del cuenco )|(?<=Alto total del taburete )|(?<=Alto con tapa ))((\d*\.\d{1,2})|(\d*))/g)?.[0];
        if (height !== undefined) row.height = [{ text: `${height}` }];
        const width1 = text.match(/((?<=Ancho: )|(?<=Ancho.)|(?<=Ancho total aprox. )|(?<=Ancho aprox. ))(\d*.\d{1,2}(?=x)|\d*(?=x))/g)?.[0];
        const width2 = text.match(/((?<=x)\d{1,9}.\d{1,3}|(?<=x)\d{1,9})/g)?.[0];
        if (width1 !== undefined && width2 !== undefined) {
          row.width = [{ text: `${width1}` }];
          row.length = [{ text: `${width2}` }];
        } else {
          const width = text.match(/((?<=Ancho: )|(?<=Ancho.)|(?<=Ancho total aprox. )|(?<=Ancho aprox. )|(?<=Ancho total ))((\d*\.\d{1,2})|(\d*))/g)?.[0];
          const length = text.match(/((?<=Ancho: )|(?<=Ancho.)|(?<=Ancho total aprox. )|(?<=Ancho aprox. )|(?<=Ancho total ))((\d*\.\d{1,2})|(\d*))/g)?.[1];
          if (width !== undefined && length !== undefined) {
            row.width = [{ text: `${width}` }];
            row.length = [{ text: `${length}` }];
          }
        }
      }

      if (text.includes('Dimensões ')) {
        const height = text.match(/(?<=Dimensões : )((\d*,\d*(?=x))|(\d*(?=x)))/g)?.[0];
        const width = text.match(/(?<=\dx)((\d*,\d*(?=x))|(\d*(?=x)))/g)?.[0];
        const length = text.match(/(?<=\dx)((\d*,\d*)|(\d*(?= )))/g)?.[0];
        if (height !== undefined) row.height = [{ text: `${height}` }];
        row.width = [{ text: `${width}` }];
        row.length = [{ text: `${length}` }];
      }

      if (format1 !== undefined) {
        const height = text.match(/(?<=L)((\d*,\d*(?=x))|(\d*(?=x)))/g)?.[0];
        const width = text.match(/(?<=xH)((\d*,\d*(?=x))|(\d*(?=x)))/g)?.[0];
        const length = text.match(/(?<=xW)((\d*,\d*)|(\d*(?= )))/g)?.[0];
        if (height !== undefined) row.height = [{ text: `${height}` }];
        if (width !== undefined) row.width = [{ text: `${width}` }];
        if (length !== undefined) row.length = [{ text: `${length}` }];
      }

      if (format2 !== undefined) {
        const height = text.match(/((?<=x[H,W])((\d*,\d*)|(\d*)(?= )))/g)?.[0];
        const widthlenght = text.match(/((?<=[L,D])((\d*,\d*(?=x))|(\d*(?=x))(?=x[H,W])))/g)?.[0];
        if (height !== undefined) row.height = [{ text: `${height}` }];
        if (widthlenght !== undefined) row.width = [{ text: `${widthlenght}` }];
        if (widthlenght !== undefined) row.length = [{ text: `${widthlenght}` }];
      }

      return text;
    },
    size_tmp: (text, row) => {
      const format1 = text.match(/(?<=Talla:\s)(\d*X\d*X\d*)/g)?.[0];
      const format2 = text.match(/(?<=Talla:\s)(\d*X\d*)/g)?.[0];
      if (format1 !== undefined) {
        const height = text.match(/(?<=Talla:\s)(\d*)/g)?.[0];
        const width = text.match(/(?<=X)((\d*,\d*(?=X))|(\d*(?=X)))/g)?.[0];
        const length = text.match(/(?<=X)(\d*)/g)?.[1];
        if (height !== undefined) row.height = [{ text: `${height}` }];
        if (width !== undefined) row.width = [{ text: `${width}` }];
        if (length !== undefined) row.length = [{ text: `${length}` }];
      } else if (format2 !== undefined) {
        const length = text.match(/(?<=Talla:\s)(\d*)/g)?.[0];
        const width = text.match(/(?<=X)(\d*)/g)?.[0];
        if (width !== undefined) row.width = [{ text: `${width}` }];
        if (length !== undefined) row.length = [{ text: `${length}` }];
      }
    },
    weight_raw: (text) => {
      text = text.replace(',', '.');
      text = text.replace(' ', '');
      return text;
    },
    offer_price: (text) => {
      text = text.replace(',', '.');
      text = text.replace(' ', '');
      return text;
    },
    original_price: (text) => {
      text = text.replace(',', '.');
      text = text.replace(' ', '');
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
