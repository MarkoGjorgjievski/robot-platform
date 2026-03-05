/* eslint-disable no-param-reassign */
/**
 *
 * @param {ImportIO.Group[]} data
 * @returns {ImportIO.Group[]}
 */

const cleanUp = (data) => {
  const colors = [
    '红色', // Red
    '蓝色', // Blue
    '绿色', // Green
    '黄色', // Yellow
    '紫色', // Purple
    '橙色', // Orange
    '粉色', // Pink
    '棕色', // Brown
    '灰色', // Gray
    '黑色', // Black
    '白色', // White
    '米色', // Beige
    '青色', // Cyan
    '深蓝', // Navy Blue
    '天蓝', // Sky Blue
    '湖蓝', // Lake Blue
    '宝蓝', // Royal Blue
    '藏蓝', // Dark Blue
    '浅蓝', // Light Blue
    '翠绿', // Emerald Green
    '草绿', // Grass Green
    '橄榄绿', // Olive Green
    '暗绿', // Dark Green
    '浅绿', // Light Green
    '黄绿', // Yellow Green
    '金色', // Gold
    '银色', // Silver
    '铜色', // Bronze
    '橙红', // Orange Red
    '玫瑰红', // Rose Red
    '樱桃红', // Cherry Red
    '深红', // Deep Red
    '浅红', // Light Red
    '暗红', // Dark Red
    '紫罗兰', // Violet
    '淡紫', // Lavender
    '深紫', // Dark Purple
    '浅紫', // Light Purple
    '茶色', // Tea
    '栗色', // Maroon
    '巧克力色', // Chocolate
    '桔色', // Tangerine
    '珊瑚色', // Coral
    '桃色', // Peach
    '浅粉', // Light Pink
    '深粉', // Deep Pink
    '灰蓝', // Slate Blue
    '深灰', // Dark Gray
    '浅灰', // Light Gray
    '墨绿', // Ink Green
    '青绿', // Aqua Green
    '荧光绿', // Neon Green
    '薄荷绿', // Mint Green
    '苹果绿', // Apple Green
    '深黄', // Dark Yellow
    '浅黄', // Light Yellow
    '奶油色', // Cream
    '象牙色', // Ivory
    '雪白色', // Snow White
    '纯白色', // Pure White
    '淡蓝色', // Pale Blue
    '淡绿色', // Pale Green
    '淡黄色', // Pale Yellow
    '淡紫色', // Pale Purple
    '淡粉色', // Pale Pink
    '淡橙色', // Pale Orange
    '天鹅绒', // Velvet
    '玫瑰金', // Rose Gold
  ];

  function extractDimensionValue(dimensionsString, dimension) {
    const dimensions = dimensionsString.match(/(\d+\.?\d*)/g);
    if (!dimensions) return null;
    const dimensionMap = { length: 0, width: 1, height: 2 };
    return dimensions[dimensionMap[dimension]] || null;
  }

  //
  function convertPercentageToRating(percentage) {
    // Ensure the input percentage is between 0 and 100
    percentage = Math.min(100, Math.max(0, percentage));

    // Scale the percentage to the 5-star range
    // (percentage / 100) * 5
    return (percentage / 100) * 5;
  }

  function replaceQueryParam(url, paramName, newValue) {
    const pattern = new RegExp(`(${paramName}=).*?(&|$)`, 'i');
    if (url?.match(pattern)) {
      return url.replace(pattern, `$1${newValue}$2`);
    }
    return `${url + (url.indexOf('?') > 0 ? '&' : '?') + paramName}=${newValue}`;
  }

  const mapping = {
    stock_availability: (text) => {
      const textNum = +text;
      return textNum > 0 ? 'yes' : 'no';
    },
    colour: text => (colors.includes(text) ? text : null),
    length: text => extractDimensionValue(text, 'length'),
    width: text => extractDimensionValue(text, 'width'),
    height: text => extractDimensionValue(text, 'height') || 11111111,
    average_rating: (text) => {
      const final = +text;
      return typeof final === 'number' ? convertPercentageToRating(final)
        .toFixed(1) : null;
    },
    // eslint-disable-next-line consistent-return
    listing_id: (text) => {
      if (text) {
        const url = new URL(text);
        const { pathname } = url;
        const segments = pathname.split('/');
        return segments[segments.length - 1];
      }
    },
    product: (text, row) => {
      const baseUrl = row?.parentURL?.[0]?.text;
      const withoutWindowGlobal = text?.replace('window._global = ', '');
      const withoutSpecifiedBlocks = withoutWindowGlobal.replace('if (_global.url && _global.kdt_id) { if (_global.miniprogram && _global.miniprogram.isSwanApp) { _global.url.shop_wap = _global.url.wap; } else { var shopId = Number(_global.kdt_id) + 192168; _global.url.shop_wap = _global .url .wap .replace(/h5(\\.youzan\\.com)/, function (match, domain) { return \'shop\' + shopId + domain; }); } }', '');
      const arraiIds = JSON.parse(withoutSpecifiedBlocks)?.goodsData?.skuInfo?.skuPrices;
      const arr = [];
      // eslint-disable-next-line array-callback-return
      arraiIds?.map((el) => {
        const url = replaceQueryParam(baseUrl, 'banner_id', el.skuId);
        arr.push({ text: url });
      });
      if (arr.length > 1) {
        row.product_variations = arr;
      } else {
        row.product_variations = null;
      }
    },
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
