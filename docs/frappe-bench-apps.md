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
| `murzak_pos` | 0.0.1 | Murzak POS. **Renamed from `techsavanna_pos`** (originally the third-party `Shavia-bit/savanna_pos_tech`); the app's own git history now shows its pull requests in the `MurzakTech` GitHub organisation. The Python package, and so every API method path, is `murzak_pos.*` |
| `murzak_custom` | 0.0.1 | Murzak/customer customisations |
| `matatuke_api`, `logistics_core` | 0.0.1 | Matatuke transport app |

## Site → app mapping

Apps are installed **per site**, so being in the bench is not the same as being
available to a customer.

| Site | Apps |
|---|---|
| `erp.murzaktech.tech` | erpnext, murzak_custom, **hrms**, **csf_ke** |
| `api.pos.murzaktech.tech` | erpnext, murzak_pos, **kenya_compliance** (confirmed with `bench list-apps` on 2026-10-17) |
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
- `murzak_pos` now declares its dependency itself
  (`required_apps = ["frappe/erpnext", "navariltd/kenya_compliance"]`, checked
  2026-10-17), so the old local patch to its predecessor is no longer needed.
  `kenya_compliance` stays in each POS tier's `benchApps` because the
  provisioner installs apps in the listed order.
- **The rename broke POS provisioning.** The catalogue and
  `murzak-bench-provision` kept asking for `techsavanna_pos`, so the host runner
  refused every Murzak POS job ("app 'techsavanna_pos' is not installed on this
  bench"). Fixed by renaming them; the VPS needs the new
  `bench-catalog-snapshot.json` and `murzak-bench-provision`.
- **Deploy drift:** the live `conf.d/00-murzak-pos-guard-map.conf` already
  covers both app names and has a `password_reset` rule that
  `deploy/vps/nginx/00-murzak-pos-guard-map.conf` in this repo lacks. Deploying
  the repo copy over the live one would reopen sign-up on tenant POS sites for
  `murzak_pos`. Sync the repo copy from the live file before ever installing
  it.
- Customer sites get none of this automatically. Provisioning a customer who
  buys payroll or eTIMS means installing the relevant apps on their site.
