module.exports = {
  implements: 'robots/san-antonio/beforeExtract',
  parameterValues: {
    country: 'KR',
    domain: 'naver',
    schemaYAML: 'singlePage',
  },
  dependencies: { helpers: 'module:helpers/helpers' },
  implementation: async (inputs, parameters, context, dependencies) => {
    const { helpers: { Helpers } } = dependencies;
    const helpers = new Helpers(context);
    // @ts-ignore
    if (inputs.schemaYAML === 'auth' && typeof extractorContext !== 'undefined') {
      /* eslint-disable no-undef */
      // Only works on daydream

      if (await helpers.checkSelector('//*[@class="warning"]//caption[contains(text(),"Suspicious sign-in activity")]', 'XPATH')) {
        console.log('The account is now restricted stop all retries');
        await context.halt(true);
      }

      const cookiesRaw = await helpers.checkAndReturnProp('#added_cookies', 'CSS', 'textContent');
      const cookies = JSON.parse(cookiesRaw);
      const [cookieNIDAUT, cookieNIDSES] = cookies
        .filter(({ name }) => ['NID_AUT', 'NID_SES'].includes(name))
        .map(({ value }) => value)
        .sort((a, b) => a.length - b.length);
      if (cookieNIDAUT && cookieNIDSES) {
        const rootFolder = 'coupang:naver:users';
        const listNameNaverPay = `${rootFolder}:current`;
        const listNamePublic = `${rootFolder}:current_public`;
        const userFolderKey = `${rootFolder}:${inputs.usr}`;
        const activeSessionsKeys = `${userFolderKey}:active_sessions`;

        const listFromStorage = async (key) => {
          // @ts-ignore
          const raw = await extractorContext.storage.get(key);
          if (!raw) return [];
          try {
            const list = JSON.parse(raw);
            if (list && Array.isArray(list)) return list;
            return [];
          } catch (error) {
            return [];
          }
        };
        const listName = inputs.isnaverpay === 'TRUE' ? listNameNaverPay : listNamePublic;
        const listCreds = await listFromStorage(listName);
        console.log(listCreds);
        console.log('Read list name as:', typeof listCreds, listCreds);
        if (!listCreds.includes(inputs.usr)) {
          // @ts-ignore
          await extractorContext.storage.set(listName, [...listCreds, inputs.usr]);
          console.log('Update list of users to include', inputs.usr);
        }
        const listSessions = await listFromStorage(activeSessionsKeys);
        // @ts-ignore
        const uniqueActiveSessions = [...new Set([...listSessions, cookieNIDAUT])];
        // @ts-ignore
        await extractorContext.storage.set(activeSessionsKeys, uniqueActiveSessions);
        console.log('Saved on redis the following sessions:', uniqueActiveSessions);

        const cookieStorageKey = `${userFolderKey}:${cookieNIDAUT}`;
        // @ts-ignore
        await extractorContext.storage.set(cookieStorageKey, { cookies: { NID_AUT: cookieNIDAUT, NID_SES: cookieNIDSES, NNB: null } });

        // @ts-ignore
        const data = await extractorContext.storage.get(cookieStorageKey);
        console.log(`Saved in reddis @ ${cookieStorageKey}: `, data);
      } else {
        console.log('Did not find any auth cookies');
        console.log(cookieNIDSES);
        console.log(cookieNIDAUT);
      }
      console.log('End before extract==========================');
      /* eslint-enable no-undef */
    }
    if (inputs.schemaYAML === 'productPage') {
      const { log } = console;
      console.log = () => {};
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
    }
    if (inputs.schemaYAML === 'blank') {
      await context.saveJson('blank', { blank: 'blank' });
    }
  },
};
