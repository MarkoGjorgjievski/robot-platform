/* eslint-disable no-console */
module.exports = {
  implements: 'robots/san-antonio/beforeExtract',
  parameterValues: {
    country: 'KR',
    domain: 'naver',
    schemaYAML: 'singlePage',
  },
  dependencies: { helpers: 'module:helpers/helpers' },
  implementation: async (inputs, parameters, context) => {
    if (inputs.schemaYAML === 'productPage') {
      const { log, trace } = console;
      console.log = () => {};
      console.trace = () => {};
      let benefitsCount = 0;

      const getResponse = async req => req?.map((response) => {
        log('attempting to decode a response');
        benefitsCount += 1;
        const res = {
          url: response?.url,
          method: response?.method,
        };
        const { body, base64Encoded } = response?.responseBody || {};
        if (base64Encoded) {
          res.body = JSON.parse(Buffer.from(body, 'base64').toString('utf-8') || '{}');
        } else {
          res.body = body || {};
        }
        return res;
      }) || [];

      const handleBenefits = async (method) => {
        log('handle benefits');
        const searchBenefits = await context?.searchAllRequests('benefit', method);
        log('searchBenefits;', method, searchBenefits.length);
        const benefits = await getResponse(searchBenefits);
        await Promise.all(benefits.map(async (benefit) => {
          log('appending benefits');
          await context?.evaluate((ben) => {
            const div = document.createElement('div');
            div.setAttribute('class', `${ben?.method.toLowerCase()}Benefits`);
            div.setAttribute('url', ben?.url);
            div.innerText = JSON.stringify(ben);
            document.body.appendChild(div);
          }, benefit);
        }));
      };

      await Promise.all(['POST', 'GET'].map(method => handleBenefits(method)));

      log('benefitsCount', benefitsCount);
      if (benefitsCount < 1) throw new Error('no benefits');

      await context?.evaluate((count) => {
        const div = document.createElement('div');
        div.setAttribute('class', 'benefitsCount');
        div.innerText = count;
        document.body.appendChild(div);
      }, benefitsCount);

      console.log = log;
      console.trace = trace;
    }
    if (inputs.schemaYAML === 'blank') {
      await context.saveJson('blank', { blank: 'blank' });
    }
  },
};
