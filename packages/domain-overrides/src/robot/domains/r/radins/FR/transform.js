/**
 *
 * @param {ImportIO.Group[]} data
 * @returns {ImportIO.Group[]}
 */
const cleanUp = (data) => {
  const mapping = {
    offer_code: (text => text.replace('coupon-', '').replace('discount-', '')),
    merchant: (text => text.split(' : ')[0]),
    Exclusive: (text => (text.includes('Excl') ? '1' : '0')),
    voucherURL: (text, row) => {
      // eslint-disable-next-line no-unused-expressions, no-param-reassign
      const shopName = row.shopName?.[0]?.text;
      const newOfferCodeId = row.new_offer_code_id?.[0]?.text;
      return `https://www.radins.com/code-promo/${shopName}/#voucher-${newOfferCodeId}`;
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
