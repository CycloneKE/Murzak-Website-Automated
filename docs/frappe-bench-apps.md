# Frappe bench apps — what's installed and why

The ERPNext bench lives at `/home/murzakerp/frappe-bench` on the VPS, owned by
the `murzakerp` user. It is **not** managed by Coolify and is not in this repo —
this file records what is installed there and the traps involved, because the
app set directly backs product claims on the storefront.

Frappe 15.95.0 / ERPNext 15.94.1 (version-15).

## Apps in the bench

| App | Version | Provides |
|---|---|---|
| `frappe` / `erpnext` | 15.95 / 15.94 | Core platform and ERP |
| `hrms` | 15.63.4 (version-15) | Payroll, salary structures, attendance, leave |
| `csf_ke` | **v16.12.0 (pinned tag)** | Kenya statutory: PAYE (P9A/P10), NSSF, SHIF, Housing Levy, HELB, withholding tax |
| `kenya_compliance` | 0.8.2 (develop) | KRA eTIMS via OSCU — the `Navari KRA eTims Settings` doctype |
| `techsavanna_pos` | 0.0.1 | POS. **Third-party**, remote `Shavia-bit/savanna_pos_tech` |
| `murzak_custom` | 0.0.1 | Murzak/customer customisations |
| `matatuke_api`, `logistics_core` | 0.0.1 | Matatuke transport app |

## Site → app mapping

Apps are installed **per site**, so being in the bench is not the same as being
available to a customer.

| Site | Apps |
|---|---|
| `erp.murzaktech.tech` | erpnext, murzak_custom, **hrms**, **csf_ke** |
| `api.pos.murzaktech.tech` | erpnext, techsavanna_pos, **kenya_compliance** |
| `erp.mystylecarhire.com` | erpnext, murzak_custom — **a paying customer's site; do not change without asking them** |
| `matatuke.murzaktech.tech` | matatuke_api |

## Traps, all hit for real on 2026-09-05

**`bench get-app` reports a scary traceback that is not a failure.** It ends
with `CalledProcessError: Command 'sudo supervisorctl status' returned non-zero
exit status 1` because `murzakerp` cannot run supervisorctl. The app downloads
and installs into the venv correctly. Verify with `ls apps` and an import check
rather than trusting the exit noise.

**Installing an app 500s every site until the workers restart.** The site starts
declaring the app while the running gunicorn workers still hold a stale module
path, so you get `ModuleNotFoundError: No module named '<app>'`. This is the
same permission gap as above — bench cannot restart the processes itself.

```bash
sudo supervisorctl restart frappe-bench-web: frappe-bench-workers:
```

**Never `supervisorctl restart all`.** Supervisor also manages `osrm-routing`,
which is the live map product behind `maps.` and `shipstack.`. Restart the two
Frappe groups by name.

**`hrms` will not install until a user-type limit exists.** It fails with
`The limit has not set for the user type Employee Self Service in the site
config file`, leaving the app half-registered and the site down. Set the limit
first, then `bench migrate` to finish:

```bash
bench --site <site> set-config -p user_type_doctype_limit '{"employee_self_service": 50}'
bench --site <site> migrate
```

**`hrms` migrate ends on `Cannot edit Standard charts`.** A dashboard-chart
conflict. Everything else migrates; the site is fine after a worker restart.

**Back up before any install.** `bench --site <site> backup`. Site backups were
between three weeks and four months stale when this work started — the paying
customer's site had none since 2026-06-21.

## Open

- `csf_ke` is pinned to tag **v16.12.0** (detached HEAD). Note its numbering is
  the app's **own semver**, not a Frappe version — v16.12.0 does not mean
  "for Frappe v16", and there is no v15/v14 line. Its only branch is `develop`.
  It was previously sitting on an untagged `develop` commit (`8f543b3`), which
  meant `bench update` could move it arbitrarily; the pin stops that. Rolling
  back means `git checkout 8f543b3` in `apps/csf_ke`, then migrate and restart.
- `techsavanna_pos` had an undeclared dependency on `kenya_compliance`; a local
  patch adds it to `required_apps`, but that app is third-party and **the edit
  is lost on the next pull**. It belongs upstream.
- Customer sites get none of this automatically. Provisioning a customer who
  buys payroll or eTIMS means installing the relevant apps on their site.
