/* eslint-disable no-param-reassign */
/**
 *
 * @param {ImportIO.Group[]} data
 * @returns {ImportIO.Group[]}
 */
//
const cleanUp = (data) => {
  const onRegexp = (str) => {
    const match = str.match(/buddhaCrosssell.collectionHandle='([^']+)'/);
    return match ? match[1] : null;
  };
  const colors = [
    'blu',
    'rosso',
    'verde',
    'giallo',
    'nero',
    'bianco',
    'arancione',
    'rosa',
    'viola',
    'marrone',
    'grigio',
    'beige',
    'turchese',
    'oro',
    'argento',
    'lavanda',
    'indaco',
    'turchese',
    'bordeaux',
    'oliva',
    'ciano',
    'magenta',
    'pesca',
    'carbone',
    'avorio',
    'corallo',
    'bronzo',
    'menta',
    'senape',
    'rubino',
    'blu reale',
    'prugna',
    'verde bosco',
    'salmone',
    'arancio',
    'lilla',
    'navy',
    'mogano',
    'rosa',
    'borgogna',
    'azzurro',
    'verde oliva',
    'limone',
    'malva',
    'cioccolato',
    'acqua',
    'orchidea',
    'peltro',
    'rubino rosso',
  ];

  function getColorsInText(text) {
    // Convert the text to lowercase for case-insensitive comparison
    const lowercaseText = text.toLowerCase();

    // Filter colors present in the text
    const foundColors = colors.filter(color => lowercaseText.includes(color));

    // Join the found colors into a single string
    return foundColors.length > 0 ? foundColors.join(', ') : null;
  }

  const diameterReg = 'øs*(\\d+)\\s*cm';
  const diameterReg2 = 'diametro (\\d+(\\,\\d+)?)';
  const onDiameterRegexp = (str) => {
    const match = str.match(diameterReg);
    const match2 = str.match(diameterReg2);
    // eslint-disable-next-line no-nested-ternary
    return match ? match[1] : match2 ? match2[1] : null;
  };

  const mapping = {
    platform_category: text => onRegexp(text),
    stock_availability: text => (text === 'no' ? text : 'yes'),
    colour: (text) => {
      if (text.includes('Colore:')) {
        return text.replace('Colore:', '');
      }
      if (text.includes('Colore')) {
        return text.replace('Colore', '');
      }
      if (text.includes('nera')) {
        return 'nera';
      }
      if (text.includes('black e white')) {
        return 'black e white';
      }
      return getColorsInText(text);
    },
    diameter: text => onDiameterRegexp(text),
    alternative_images: text => text?.replace(/^\/\//, 'https://'),
    main_image: text => text?.replace(/^\/\//, 'https://'),
    original_price: text => text?.replace('€', ''),
    offer_price: text => text?.replace('€', ''),
  };
  const mappingFct = (header, arr, row) => [...arr.map(({
    text,
    ...other
  }) => ({ text: mapping[header](text, row), ...other }))];
  data.forEach(obj => obj.group.forEach(row => Object.keys(row)
    .forEach((header) => {
      // eslint-disable-next-line no-param-reassign
      if (mapping[header]) row[header] = mappingFct(header, row[header], row);
    })));
  return data;
};

module.exports = { cleanUp };
