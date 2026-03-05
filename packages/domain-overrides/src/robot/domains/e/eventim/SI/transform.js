/**
 *
 * @param {ImportIO.Group[]} data
 * @returns {ImportIO.Group[]}
 */
const cleanUp = (data) => {
  const venueDictionary = {
    'CANKARJEV DOM': { address: 'Prešernova cesta 10', code: '1000' },
    'Kino Šiška': { address: 'Trg prekomorskih brigad 3', code: '1000' },
    'Festivalna dvorana Ljubljana': { address: 'Vilharjeva cesta 11', code: '1000' },
    'Dvorana Tivoli': { address: 'Celovška cesta 25', code: '1000' },
    'Slovenska filharmonija': { address: 'Kongresni trg 10', code: '1000' },
    'MINI TEATER': { address: 'Križevniška ulica 1', code: '1000' },
    'Različna prizorišča': { address: 'Kino Šiška, Ljubljanski grad, Stara mestna elektrarna', code: '1000' },
    'Publika Bar Klub': { address: 'Vilharjeva 11', code: '1000' },
    'Dvorana Stožice': { address: 'Vojkova cesta 100', code: '1000' },
    'Klub CVETLIČARNA': { address: 'Kranjčeva 20', code: '1000' },
    KRIŽANKE: { address: 'Trg francoske revolucije 1', code: '1000' },
    'MEDIA CENTER CVETLIČARNA': { address: 'Kranjčeva ulica 22', code: '1000' },
    'Center kulture Španski borci': { address: 'Zaloška 61', code: '1000' },
    'Kino gledališče Bežigrad': { address: 'Linhartova 11', code: '1000' },
    'Center Zalog': { address: 'Zaloška cesta 267', code: '1000' },
    'HALA L56 - Industrijska cona Litostroj': { address: 'Litostrojska cesta 56', code: '1000' },
    'Čopova ulica': { address: 'Čopova ulica 14', code: '1000' },
    'Narodni dom Maribor': { address: 'Ul. Kneza Koclja 9', code: '2000' },
    'Dvorana Tabor': { address: 'Koresova ulica 7', code: '2000' },
    Štuk: { address: 'Gosposvetska cesta 83', code: '2000' },
    'Festivalna dvorana Lent Maribor': { address: 'Loška ulica13', code: '2000' },
    'SNG Maribor': { address: 'Slovenska ulica 27', code: '2000' },
    'Minoritska cerkev': { address: 'Vojašniški trg 2', code: '2000' },
    'KGB Maribor': { address: 'Vojašniški trg 5', code: '2000' },
    'Celjski dom': { address: 'Krekov trg 3', code: '3000' },
    'Narodni dom Celje': { address: 'Trg celjskih knezov 9', code: '3000' },
    'Celjski grad': { address: 'Cesta na grad 78', code: '3000' },
    'Dvorana Metropol': { address: 'Stanetova ulica 15', code: '3000' },
    'Dvorana D, Celjski sejem': { address: 'Dečkova 1', code: '3000' },
    'Kulturni center Janeza Trdine': { address: 'Novi trg 5', code: '8000' },
    'Dvorana Leona Štuklja Novo mesto': { address: 'Šegova ulica 112', code: '8000' },
    'Športna dvorana Marof': { address: 'Kettejev drevored 2', code: '8000' },
    'Trdinova dvorana': { address: 'Novi trg 5', code: '8000' },
    'Kulturni dom Nova Gorica': { address: 'Bevkov trg 4', code: '5000' },
    'Park, Hotel & Entertainment': { address: 'Delpinova 5', code: '5000' },
    Primskovo: { address: 'Jezerska cesta 41', code: '4000' },
    'Letno gledališče Khislstein': { address: 'Tomšičeva 44', code: '4000' },
    'Dvorana Zlato polje': { address: 'Kidričeva cesta 55', code: '4000' },
    'Dom krajanov Primskovo': { address: 'Jezerska cesta 41', code: '4000' },
    'Arena Bonifika Koper': { address: 'Cesta Zore Perello Godina 3', code: '6000' },
    'Gledališče Koper': { address: 'Verdijeva ulica 3', code: '6000' },
    'Avditorij Portorož': { address: 'Senčna pot 8A', code: '6320' },
    'KONGRESNI CENTER Hotel Slovenija, LifeClass Portorož': { address: 'Obala 33', code: '6320' },
    'Grando Portorož': { address: 'Obala 10', code: '6320' },
    'Festivalna dvorana Bled': { address: 'Cesta svobode 11', code: '4260' },
    'Dom kulture Velenje': { address: 'Titov trg 4', code: '3320' },
    'Rdeča dvorana Velenje': { address: 'Šaleška cesta 3', code: '3320' },
    'Mestno gledališče Ptuj': { address: 'Slovenski trg 13', code: '2250' },
    'Mestna tržnica Ptuj': { address: 'Mestna tržnica Ptuj', code: '2250' },
    'Arena Campus Sava Ptuj': { address: 'Žnidaričevo nabrežje 2', code: '2250' },
    'Minoritski samostan': { address: 'Minoritski trg 1', code: '2250' },
    'Slavnostna dvorana Ptujskega gradu': { address: 'Na gradu 1', code: '2250' },
    'Dom kulture Muzikafe': { address: 'Vrazov trg 1', code: '2250' },
  };
  const mapping = {
    eventName: text => text.replace(/ - prestavljeno iz (.+) na (.+)/, '').replace(/(\d+[./]\d+[./]\d+)/, ''), // remove dates from event names
    eventDate: text => text.split('/').reverse().join('-'), // restructure date
    venueAddress: (text, row) => venueDictionary[row.venueName?.[0]?.text]?.address ?? null,
    postalCode: (text, row) => venueDictionary[row.venueName?.[0]?.text]?.code ?? null,

  };
  const mappingFct = (header, arr, row) => [...arr.map(({ text, ...other }) => ({ text: mapping[header](text, row), ...other }))];

  data.forEach(obj => obj.group.forEach(row => Object.keys(row).forEach((header) => {
    // eslint-disable-next-line no-param-reassign
    if (mapping[header]) row[header] = mappingFct(header, row[header], row);
  })));
  return data;
};

module.exports = { cleanUp };
