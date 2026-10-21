#!/usr/bin/env bash
# Tests murzak-shop-lifecycle against a fake bench folder and a fake website
# Frappe. No real server is touched.   Run:  bash deploy/vps/test/shop-lifecycle.test.sh
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
SCRIPT="$HERE/../bin/murzak-shop-lifecycle"
T="$(mktemp -d)"; trap 'kill $SRV 2>/dev/null || true; rm -rf "$T"' EXIT
fail=0
check() { if [ "$2" = "$3" ]; then echo "ok   - $1"; else echo "FAIL - $1 (wanted '$3', got '$2')"; fail=1; fi; }

mkdir -p "$T/bench/sites" "$T/web"
mk() { # site account [extra json]
  mkdir -p "$T/bench/sites/$1"
  printf '{"db_name":"x"%s%s}' "${2:+,\"murzak_web_account\":\"$2\"}" "${3:+,$3}" > "$T/bench/sites/$1/site_config.json"
}
mk paid.erp.murzaktech.tech       acc-paid
mk lapsed.erp.murzaktech.tech     acc-lapsed
mk cancelled.erp.murzaktech.tech  acc-cancelled
mk rowsus.erp.murzaktech.tech     acc-rowsus
mk resume.erp.murzaktech.tech     acc-paid2 '"maintenance_mode":1,"murzak_lifecycle_off":1'
mk manual.erp.murzaktech.tech     acc-paid3 '"maintenance_mode":1'
mk unreadable.erp.murzaktech.tech acc-missing
mk company.erp.murzaktech.tech    ""                       # no owner stamp: never touched
mk notpos.erp.murzaktech.tech     acc-lapsed
cat > "$T/bench/bench" <<'B'
#!/usr/bin/env bash
[ "$2" = "notpos.erp.murzaktech.tech" ] && { echo "frappe"; echo "erpnext"; exit 0; }
printf 'frappe\nerpnext\nmurzak_pos\n'
B
chmod +x "$T/bench/bench"

doc() { printf '{"data":{"account_status":"%s","selected_services":[%s]}}' "$2" "$3" > "$T/web/$1"; }
doc acc-paid       Active    '{"service_id":"pos-a","status":"Active"}'
doc acc-lapsed     Suspended '{"service_id":"pos-a","status":"Suspended"}'
doc acc-cancelled  Cancelled ''
doc acc-rowsus     Active    '{"service_id":"pos-a","status":"Suspended"},{"service_id":"other","status":"Active"}'
doc acc-paid2      Active    '{"service_id":"pos-a","status":"Active"}'
doc acc-paid3      Active    '{"service_id":"pos-a","status":"Active"}'
# a Suspended row on a NON-POS service must not switch the shop off
mk otherrow.erp.murzaktech.tech acc-other
doc acc-other      Active    '{"service_id":"pos-a","status":"Active"},{"service_id":"other","status":"Suspended"}'

cat > "$T/snap.json" <<'J'
{"items":{"pos-a":{"benchApps":["erpnext","murzak_pos"]},"other":{"benchApps":["erpnext"]}}}
J
cat > "$T/env" <<E
FRAPPE_BASE_URL=http://127.0.0.1:8765
FRAPPE_API_KEY=k
FRAPPE_API_SECRET=s
E
# fake website Frappe: /api/resource/Web%20Account/<name> -> web/<name>, else 404
cat > "$T/srv.py" <<'P'
import http.server, os, sys
root = sys.argv[1]
class H(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        n = self.path.rsplit("/", 1)[-1]
        f = os.path.join(root, n)
        if os.path.isfile(f):
            b = open(f, "rb").read(); self.send_response(200)
        else:
            b = b'{"exc_type":"DoesNotExistError"}'; self.send_response(404)
        self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(b)
    def log_message(self, *a): pass
http.server.HTTPServer(("127.0.0.1", 8765), H).serve_forever()
P
python3 "$T/srv.py" "$T/web" & SRV=$!
sleep 1

run() { MURZAK_FRAPPE_ENV="$T/env" MURZAK_CATALOG_SNAPSHOT="$T/snap.json" BENCH_DIR="$T/bench" \
        BENCH_USER="$(id -un)" MURZAK_BENCH_BIN="$T/bench/bench" "$SCRIPT" "$@"; }
val() { python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get(sys.argv[2], "-"))' "$T/bench/sites/$1/site_config.json" "$2"; }

run sweep --dry-run 2>/dev/null || true
check "dry run changes nothing" "$(val lapsed.erp.murzaktech.tech maintenance_mode)" "-"

run sweep 2>/dev/null || true       # exit 1 expected: one account unreadable
check "lapsed shop is switched off"        "$(val lapsed.erp.murzaktech.tech maintenance_mode)" "1"
check "cancelled shop is switched off"     "$(val cancelled.erp.murzaktech.tech maintenance_mode)" "1"
check "suspended POS row switches off"     "$(val rowsus.erp.murzaktech.tech maintenance_mode)" "1"
check "paid shop stays on"                 "$(val paid.erp.murzaktech.tech maintenance_mode)" "-"
check "suspended non-POS row is ignored"   "$(val otherrow.erp.murzaktech.tech maintenance_mode)" "-"
check "paid again: our switch-off lifted"  "$(val resume.erp.murzaktech.tech maintenance_mode)" "-"
check "paid again: marker removed"         "$(val resume.erp.murzaktech.tech murzak_lifecycle_off)" "-"
check "manual maintenance is kept"         "$(val manual.erp.murzaktech.tech maintenance_mode)" "1"
check "unreadable account leaves shop"     "$(val unreadable.erp.murzaktech.tech maintenance_mode)" "-"
check "company site is never touched"      "$(val company.erp.murzaktech.tech maintenance_mode)" "-"
check "non-POS site is skipped"            "$(val notpos.erp.murzaktech.tech maintenance_mode)" "-"
check "db_name preserved"                  "$(val lapsed.erp.murzaktech.tech db_name)" "x"

run sweep 2>/dev/null || true
check "second sweep is a no-op (still off)" "$(val lapsed.erp.murzaktech.tech maintenance_mode)" "1"

doc acc-lapsed Active '{"service_id":"pos-a","status":"Active"}'   # customer pays
run sweep 2>/dev/null || true
check "payment switches the shop back on"  "$(val lapsed.erp.murzaktech.tech maintenance_mode)" "-"

run off paid.erp.murzaktech.tech 2>/dev/null
check "manual off"                         "$(val paid.erp.murzaktech.tech maintenance_mode)" "1"
run on paid.erp.murzaktech.tech 2>/dev/null
check "manual on"                          "$(val paid.erp.murzaktech.tech maintenance_mode)" "-"
rc=0; run off evil.example.com 2>/dev/null || rc=$?
check "rejects a non-tenant name (exit 2)" "$rc" "2"
exit $fail
