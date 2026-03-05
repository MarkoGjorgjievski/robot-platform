module.exports = {
  implements: 'robots/san-antonio/beforeExtract',
  parameterValues: {
    country: 'BE',
    domain: 'zalando',
    schemaYAML: 'multiPages',
  },
  implementation: async (
    inputs,
    parameters,
    context,
  ) => {
    console.log('Capturing pageloading request to get reseller ID');
    const currentPageUrl = await context.evaluate(() => window.location.pathname);
    const res = await context.searchForRequest(currentPageUrl);
    if (res) {
      const decodedData = Buffer.from(res.responseBody.body, 'base64').toString('utf-8');
      // const resellerID = decodedData
      //   .match(/https:\/\/www.zalando.([\w\\.]{2,5})\/checkout\/partner\/([a-zA-Z0-9-]+)/g)?.[0]
      //   ?.replace(/https:\/\/www.zalando.([\w\\.]{2,5})\/checkout\/partner\//g, '')
      //   || 'not found';
      // await context.saveJson('resellerID', resellerID);

      const resellerIdRegex = /([^"]+)","uri":"https:\/\/www.zalando.([\w\\.]{2,5})\/checkout\/partner\/([a-zA-Z0-9-]+)/g;
      const idMatches = decodedData.match(resellerIdRegex)
        ?.map(x => x.split(resellerIdRegex));
      const nameToID = idMatches ? Object.fromEntries(idMatches.map(arr => [arr?.[1], arr?.[3]])) : {};
      await context.saveJson('resellerID_MAP', nameToID);
    }
  },
};
