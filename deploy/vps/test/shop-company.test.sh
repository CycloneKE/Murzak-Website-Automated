#!/usr/bin/env bash
# Tests the Company step of murzak-shop-setup against a fake bench (a stub for
# the bench's python) and a fake website Frappe. No real server is touched.
#   Run:  bash deploy/vps/test/shop-company.test.sh
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
SCRIPT="$HERE/../bin/murzak-shop-setup"
T="$(mktemp -d)"; trap 'kill $SRV 2>/dev/null || true; rm -rf "$T"' EXIT
fail=0
check() { if [ "$2" = "$3" ]; then echo "ok   - $1"; else echo "FAIL - $1 (wanted '$3', got '$2')"; fail=1; fi; }

mkdir -p "$T/bench/sites/ok.erp.murzaktech.tech" "$T/bench/sites/bad.erp.murzaktech.tech" "$T/bench/sites/other.erp.murzaktech.tech" "$T/bench/env/bin"
# Stands in for the bench's python: records what it was asked, fails for the "bad" shop
cat > "$T/bench/env/bin/python" <<'P'
#!/usr/bin/env bash
cat >/dev/null
printf '%s|%s|%s\n' "$SHOP_SITE" "$SHOP_NAME" "$SHOP_OWNER" >> "$CALLS"
if [ "$SHOP_SITE" = "bad.erp.murzaktech.tech" ]; then echo "Traceback: boom" >&2; exit 1; fi
printf '{"state":"created","company":"%s"}\n' "$SHOP_NAME"
P
chmod +x "$T/bench/env/bin/python"
: > "$T/calls"

cat > "$T/env" <<E
FRAPPE_BASE_URL=http://127.0.0.1:8766
FRAPPE_API_KEY=k
FRAPPE_API_SECRET=s
E

cat > "$T/srv.py" <<'P'
import http.server, json, urllib.parse
JOBS = [
  {"name": "J1", "invoice": "INV1", "service_id": "biz-pos-inventory", "access": json.dumps({"site": "ok.erp.murzaktech.tech", "posUser": "owner@ok.test"})},
  {"name": "J2", "invoice": "INV2", "service_id": "biz-pos-inventory", "access": json.dumps({"site": "bad.erp.murzaktech.tech", "posUser": "owner@bad.test"})},
  {"name": "J3", "invoice": "INV3", "service_id": "biz-erp-light", "access": json.dumps({"site": "other.erp.murzaktech.tech", "posUser": "x@y.test"})},
  {"name": "J4", "invoice": "INV4", "service_id": "biz-pos-inventory", "access": json.dumps({"site": "other.erp.murzaktech.tech", "posUser": ""})},
]
ORDERS = {
  "O1": {"name": "O1", "invoice_doc_name": "INV1", "status": "Paid", "config_json": json.dumps({"app": "pos", "shopName": "Empire Silver"})},
  "O2": {"name": "O2", "invoice_doc_name": "INV2", "status": "Paid", "config_json": json.dumps({"app": "pos", "shopName": "Bad Shop"})},
  "O4": {"name": "O4", "invoice_doc_name": "INV4", "status": "Paid", "config_json": json.dumps({"app": "pos", "shopName": "No Owner"})},
}
class H(http.server.BaseHTTPRequestHandler):
    def send(self, obj, code=200):
        b = json.dumps(obj).encode(); self.send_response(code)
        self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(b)
    def do_GET(self):
        u = urllib.parse.urlparse(self.path); q = urllib.parse.parse_qs(u.query)
        if u.path.endswith("/Provisioning%20Job") or u.path.endswith("/Provisioning Job"):
            return self.send({"data": JOBS})
        if "Checkout" in u.path:
            tail = urllib.parse.unquote(u.path.rsplit("/", 1)[-1])
            if tail in ORDERS: return self.send({"data": ORDERS[tail]})
            f = json.loads(q.get("filters", ["[]"])[0])
            inv = [x[2] for x in f if x[0] == "invoice_doc_name"]
            return self.send({"data": [o for o in ORDERS.values() if not inv or o["invoice_doc_name"] == inv[0]]})
        self.send({}, 404)
    def do_PUT(self):
        n = int(self.headers.get("Content-Length", 0)); body = json.loads(self.rfile.read(n))
        name = urllib.parse.unquote(self.path.rsplit("/", 1)[-1])
        ORDERS[name].update(body); self.send({"data": ORDERS[name]})
    def log_message(self, *a): pass
http.server.HTTPServer(("127.0.0.1", 8766), H).serve_forever()
P
python3 "$T/srv.py" & SRV=$!
sleep 1

run() { CALLS="$T/calls" MURZAK_FRAPPE_ENV="$T/env" BENCH_DIR="$T/bench" BENCH_USER="$(id -un)" bash "$SCRIPT" "$@"; }
state() { curl -s "http://127.0.0.1:8766/api/resource/Checkout%20Order/$1" | python3 -c 'import json,sys; c=json.loads(json.load(sys.stdin)["data"]["config_json"]); print(c.get("shopCompany",{}).get(sys.argv[1], "-"))' "$2"; }

run company 2>/dev/null || true
check "a new shop gets its Company made once"       "$(grep -c '^ok.erp' "$T/calls")" "1"
check "it is asked for the shop name from the order" "$(grep '^ok.erp' "$T/calls" | head -1)" "ok.erp.murzaktech.tech|Empire Silver|owner@ok.test"
check "the order records it as done"                 "$(state O1 state)" "done"
check "a failing shop is recorded for retry"         "$(state O2 state)" "retry"
check "a non-POS product is left alone"              "$(grep -c '^other.erp' "$T/calls")" "0"

run company 2>/dev/null || true
check "a finished shop is not touched again"         "$(grep -c '^ok.erp' "$T/calls")" "1"
check "the failing shop is tried again (2nd)"        "$(state O2 attempts)" "2"
run company 2>/dev/null || true
check "and a third time, then marked failed"         "$(state O2 state)" "failed"
run company 2>/dev/null || true
check "a failed shop is not retried forever"         "$(grep -c '^bad.erp' "$T/calls")" "3"

out="$(run company ok.erp.murzaktech.tech "Hand Made" owner@ok.test 2>/dev/null | tail -1)"
check "by hand, one shop"                            "$out" '{"state":"created","company":"Hand Made"}'
rc=0; run company evil.example.com "X" a@b.test >/dev/null 2>&1 || rc=$?
check "by hand, a missing site is refused (exit 2)"  "$rc" "2"
exit $fail
