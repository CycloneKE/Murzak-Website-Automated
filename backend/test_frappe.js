require("dotenv").config({ path: "./.env" });
const axios = require("axios");

function frappeClient() {
  return axios.create({
    baseURL: process.env.FRAPPE_BASE_URL,
    headers: {
      Authorization: `token ${process.env.FRAPPE_API_KEY}:${process.env.FRAPPE_API_SECRET}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    timeout: 10000,
  });
}

const PROVISIONING_JOB_DOCTYPE = "Provisioning Job";

async function loadOwnedJob(client, webAccountName, serviceId) {
  const listResp = await client.get(`/api/resource/${encodeURIComponent(PROVISIONING_JOB_DOCTYPE)}`, {
    params: {
      filters: JSON.stringify([
        ["web_account", "=", webAccountName],
        ["service_id", "=", serviceId],
      ]),
      fields: JSON.stringify(["name"]),
      order_by: "modified desc",
      limit_page_length: 1,
    },
  });
  const docName = listResp.data?.data?.[0]?.name;
  if (!docName) return null;

  const docResp = await client.get(`/api/resource/${encodeURIComponent(PROVISIONING_JOB_DOCTYPE)}/${encodeURIComponent(docName)}`);
  const job = docResp.data?.data;
  if (job && job.web_account !== webAccountName) return null; // never trust the filter alone
  return job;
}

async function test() {
  const client = frappeClient();
  try {
    const resp = await loadOwnedJob(client, "test-user", "starter-app-hosting");
    console.log("SUCCESS!", resp ? "Job found" : "Job not found");
  } catch (err) {
    console.error("ERROR:", err.response?.data || err.message);
  }
}

test();
