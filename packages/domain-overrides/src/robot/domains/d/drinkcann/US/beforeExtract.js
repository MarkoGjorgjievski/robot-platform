module.exports = {
  implements: 'robots/san-antonio/beforeExtract',
  parameterValues: {
    country: 'US',
    domain: 'drinkcann',
    schemaYAML: 'details',
  },
  implementation: async (inputs, parameters, context) => {
    await context.evaluate(() => {
      const preElement = document.querySelector('pre');

      const jsonData = JSON.parse(preElement.textContent);

      const container = document.createElement('div');
      container.id = 'storeData-container';

      jsonData.locations.forEach((item) => {
        const store = document.createElement('div');
        store.className = 'store';

        const storeNameElement = document.createElement('div');
        storeNameElement.className = 'store-name';
        storeNameElement.textContent = item.name;

        const addressElement = document.createElement('div');
        addressElement.className = 'store-address';
        addressElement.textContent = item.address_line_1;

        const cityElement = document.createElement('div');
        cityElement.className = 'store-city';
        cityElement.textContent = item.city;

        const stateElement = document.createElement('div');
        stateElement.className = 'store-state';
        stateElement.textContent = item.state;

        const postalCodeElement = document.createElement('div');
        postalCodeElement.className = 'store-postal-code';
        postalCodeElement.textContent = item.postal_code;

        const storeIdElement = document.createElement('div');
        storeIdElement.className = 'store-id';
        storeIdElement.textContent = item.id;

        const phoneElement = document.createElement('div');
        phoneElement.className = 'store-phone';
        phoneElement.textContent = item.phone;

        const websiteElement = document.createElement('div');
        websiteElement.className = 'store-website';
        websiteElement.textContent = item.website;

        const emailElement = document.createElement('div');
        emailElement.className = 'store-email';
        emailElement.textContent = item.email;

        store.appendChild(storeNameElement);
        store.appendChild(addressElement);
        store.appendChild(cityElement);
        store.appendChild(stateElement);
        store.appendChild(postalCodeElement);
        store.appendChild(storeIdElement);
        store.appendChild(phoneElement);
        store.appendChild(websiteElement);
        store.appendChild(emailElement);

        container.appendChild(store);
      });

      document.body.appendChild(container);
    });
  },
};
