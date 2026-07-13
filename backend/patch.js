const fs = require('fs');
let content = fs.readFileSync('server.js', 'utf8');

const target = unction frappeClient() {
  return axios.create({
    baseURL: FRAPPE_BASE_URL,
    headers: {
      Authorization: FRAPPE_AUTH,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    timeout: 15000,
  });
};

const replacement = unction frappeClient() {
  if (process.env.MOCK_FRAPPE === 'true') {
    return {
      get: async (url, config) => {
        if (url.includes('Web Account')) return { data: { data: [] } };
        if (url.includes('Test Plan Invoice')) return { data: { data: [] } };
        if (url.includes('Portal Invoice')) return { data: { data: [{ name: 'INV-MOCK', status: 'Unpaid', amount_due: 99, invoice_services: '[]', child_services_count: 1 }] } };
        if (url.includes('Web Account Service')) return { data: { data: [] } };
        return { data: { data: [] } };
      },
      post: async (url, data) => {
        if (url.includes('Web Account')) return { data: { data: { name: 'wa-' + Date.now() } } };
        if (url.includes('Portal Invoice')) return { data: { data: { name: 'inv-' + Date.now() } } };
        return { data: { data: { name: 'doc-' + Date.now() } } };
      },
      put: async (url, data) => {
        return { data: { data: { name: url } } };
      }
    };
  }
  return axios.create({
    baseURL: FRAPPE_BASE_URL,
    headers: {
      Authorization: FRAPPE_AUTH,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    timeout: 15000,
  });
};

content = content.replace(target, replacement);
fs.writeFileSync('server.js', content, 'utf8');
