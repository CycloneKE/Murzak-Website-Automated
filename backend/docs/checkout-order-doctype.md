# "Checkout Order" doctype

Backing doctype for `backend/services/checkout/orderStore.js`. Each document is
a draft purchase intent that reserves RAM on the shared box for 30 minutes
(`RESERVATION_TTL_MS`) while a buyer finishes checkout.

## Fields

| Field                     | Type                                          | Notes                                                        |
| ------------------------- | ---------------------------------------------- | ------------------------------------------------------------- |
| `web_account`              | Link → Web Account                             | Owner; scopes `getOrder`/`cancelOrder` access.                |
| `status`                   | Select: `Draft` / `Paid` / `Cancelled`, default `Draft` | Only `Draft` orders with a live reservation count toward reserved RAM. |
| `service_id`                | Data                                            | Catalog service id (from `services/provisioning/catalog.js`). |
| `service_name`              | Data                                            | Snapshot of the catalog display name at order time.           |
| `tier`                      | Data                                            | Snapshot of the catalog tier at order time.                    |
| `category`                  | Data                                            | Snapshot of the catalog category at order time.                |
| `monthly_kes`               | Int                                             | Snapshot of the catalog monthly price (KES) at order time.     |
| `setup_kes`                 | Int                                             | Snapshot of the catalog setup price (KES) at order time; 0 if the service has none. |
| `ram_mb`                    | Int                                             | Snapshot of the catalog RAM footprint (MB); this is the amount reserved. |
| `disk_gb`                   | Int                                             | Snapshot of the catalog disk footprint (GB).                   |
| `plan_key`                  | Data                                            | Plan the buyer was on/selecting when the order was created.    |
| `config_json`                | Long Text                                       | JSON-serialized checkout configuration (domain choice, etc.).  |
| `reservation_expires_at`     | Datetime                                        | RAM reservation deadline; renewed by the checkout page's heartbeat GET. |
| `invoice_doc_name`           | Data                                            | Linked Portal Invoice `name` once one exists (set by `linkInvoice`, consumed by Task 3). |
| `source`                    | Data                                            | Where the order originated (e.g. `"CloudLaunch"`, `"Configurator"`). |

Create this doctype in the Frappe admin before enabling checkout in an environment; the API returns 503 "Checkout is not configured." until it exists.
