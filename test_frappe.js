require("dotenv").config({ path: "./backend/.env" });
const axios = require("axios");

function frappeClient() {
  return axios.create({
    baseURL: process.env.FRAPPE_URL,
    headers: {
      Authorization: `token ${process.env.FRAPPE_API_KEY}:${process.env.FRAPPE_API_SECRET}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    timeout: 10000,
  });
}

const JOB_DOCTYPE = "Provisioning Job";

async function test() {
  const client = frappeClient();
  try {
    const resp = await client.get(`/api/resource/${encodeURIComponent(JOB_DOCTYPE)}`, {
      params: {
        filters: JSON.stringify([
          ["service_id", "=", "starter-app-hosting"]
        ]),
        fields: JSON.stringify(["name", "web_account", "service_id", "lane", "status", "external_ref", "log", "access", "deployment_uuid", "deployment_history"]),
        order_by: "modified desc",
        limit_page_length: 1,
      },
    });
    console.log("SUCCESS!", resp.data);
  } catch (err) {
    console.error("ERROR:", err.response?.data || err.message);
  }
}

test();
