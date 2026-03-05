/* eslint-disable no-param-reassign */
/**
 *
 * @param {ImportIO.Group[]} data
 * @returns {ImportIO.Group[]}
 */
//
const cleanUp = (data) => {
  const mapStyles = (path, map) => {
    const keyVal = path.split(':');
    const property = map?.filter(s => s.pid === keyVal?.[0])?.[0];
    const value = property?.values?.filter(v => v?.vid === keyVal?.[1])?.[0]?.name
      || property?.values?.[0]?.value?.filter(v => v?.vid === keyVal?.[1])?.[0]?.name;
    return `${property?.name}:${value}`;
  };
  const fixURL = url => ((url.match(/^\/\//)) ? `https:${url}` : url);
  const mapping = {
    listPrice: (text, row) => {
      if (text !== 'dummy') return text;
      if (row.listPriceBackup) return row.listPriceBackup?.[0]?.text;
      return null;
    },
    variance1: (text, row) => {
      if (!row.productStyle) {
        const output = new Set([text]);
        if (row.variance2) {
          output.add(row.variance2?.[0]?.text);
        }
        if (row.variance3) {
          output.add(row.variance3?.[0]?.text);
        }
        if (row.variance4) {
          output.add(row.variance4?.[0]?.text);
        }
        row.productStyle = [{ text: Array.from(output).join(' ') }];
      }
      return text;
    },
    resellerAggregateRating: text => text.replace('%', ''),
    resellerFeedbackPercent: text => text.replace('%', ''),
    resellerLink: text => fixURL(text),
    offerPrice: (text, row) => {
      if (!row.listPrice) {
        row.listPrice = [{ text }];
      }
      return text;
    },
    imagesSku: (key, row) => {
      try {
        const imagesArray = JSON.parse(row.imagesMap?.[0]?.text)?.[key];
        if (imagesArray) {
          row.images = [];
          // variant specific images are at the end of the array, this just makes checking the result easier
          imagesArray.reverse().forEach((i) => { row.images.push({ text: fixURL(i.src) }); });
        }
      } catch (e) { console.log('images', e); }
    },
    // shippingCostSku: (key, row) => {
    //   try {
    //     const deliveries = JSON.parse(row.deliveryMap?.[0]?.text);
    //     const shippingCost = deliveries?.[key]?.filter(x => x?.dataType === 'delivery')?.[0]?.feeValue;
    //     if (shippingCost) { row.shippingCost = [{ text: shippingCost }]; }
    //   } catch (e) { console.log('shippingcost', e); }
    // },
    // deliveryDateSku: (key, row) => {
    //   try {
    //     const deliveries = JSON.parse(row.deliveryMap?.[0]?.text);
    //     const deliveryDate = deliveries?.[key]?.filter(x => x?.dataType === 'delivery')?.[0]?.deliveryWorkTimeMax;
    //     if (deliveryDate) { row.deliveryDate = [{ text: deliveryDate }]; }
    //   } catch (e) { console.log('deliveryDate', e); }
    // },
    productURL: (key, row) => {
      try {
        const skuData = JSON.parse(row.skuMap?.[0]?.text);
        const path = skuData?.filter(x => x?.skuId === key)?.[0]?.pagePath;
        // CHANGEME to your url base
        if (path) return `https://www.lazada.co.th${path}`;
      } catch (e) { console.log('productURL', e); }
      return key;
    },
    productStyle: (key, row) => {
      try {
        const skuData = JSON.parse(row.skuMap?.[0]?.text);
        const styleData = JSON.parse(row.propertyMap?.[0]?.text);
        const propPath = skuData?.filter(x => x?.skuId === key)?.[0]?.propPath?.split(';');
        if (propPath) {
          return propPath.map(p => mapStyles(p, styleData))?.join(';');
        }
      } catch (e) { console.log('productStyle', e); }
      return null;
    },
    productDescription: (text, row) => {
      const fullDescription = `${text} ${(row.productHighlights?.[0]?.text || '')}`;
      return fullDescription.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    },
  };

  const mappingFct = (header, arr, row) => [...arr.map(({ text, ...other }) => ({ text: mapping[header](text, row), ...other }))];

  data.forEach((obj) => {
    obj.group.forEach(row => Object.keys(row).forEach((header) => {
      // eslint-disable-next-line no-param-reassign
      if (mapping[header]) row[header] = mappingFct(header, row[header], row);
    }));
  });
  return data;
};

module.exports = { cleanUp };
