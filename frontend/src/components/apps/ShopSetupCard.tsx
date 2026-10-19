import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Check, Loader2, UtensilsCrossed, ShoppingBasket, Scissors } from "lucide-react";
import {
  fetchShopSetup, saveShopSetup, SetupAnswers, SetupCatalogue, SetupPack, SetupState,
} from "../../services/shopSetup";
import { adviseOnPlan } from "../../config/shopSetupAdvice";
import { toUserMessage } from "../../services/errors";

const ICONS: Record<string, React.ReactNode> = {
  restaurant: <UtensilsCrossed size={20} aria-hidden="true" />,
  retail: <ShoppingBasket size={20} aria-hidden="true" />,
  services: <Scissors size={20} aria-hidden="true" />,
};

const POLL_MS = 10000;
const linkClass = "text-sm font-black text-sky-700 dark:text-murzak-accent underline underline-offset-2";
const fieldClass =
  "w-24 rounded-xl border border-slate-300 dark:border-white/20 bg-white dark:bg-white/5 px-3 py-2 font-bold text-murzak-ink dark:text-slate-100";

function recommended(pack: SetupPack, styleId: string | undefined): Record<string, boolean> {
  const style = pack.styles.find((s) => s.id === styleId) || pack.styles.find((s) => s.id === pack.defaultStyle);
  const out: Record<string, boolean> = {};
  for (const o of pack.options) out[o.id] = style && o.id in style.defaults ? style.defaults[o.id] : o.default === true;
  return out;
}

interface Props {
  orderId: string;
  serviceId: string;
}

/**
 * Asks three short questions while the shop builds, then shows what was set up.
 * Skipping is always safe: the shop keeps the POS defaults.
 */
const ShopSetupCard: React.FC<Props> = ({ orderId, serviceId }) => {
  const [cat, setCat] = useState<SetupCatalogue | null>(null);
  const [setup, setSetup] = useState<SetupState | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [packId, setPackId] = useState("");
  const [styleId, setStyleId] = useState("");
  const [options, setOptions] = useState<Record<string, boolean>>({});
  const [branches, setBranches] = useState("1");
  const [staff, setStaff] = useState("2");

  useEffect(() => {
    let cancel = false;
    fetchShopSetup(orderId)
      .then((c) => { if (!cancel) { setCat(c); setSetup(c.setup); } })
      .catch((e) => { if (!cancel) setError(toUserMessage(e, "We couldn't load the setup questions.")); });
    return () => { cancel = true; };
  }, [orderId]);

  // Once answers are saved, keep checking until the shop has them applied.
  const waiting = !!setup && (setup.state === "saved" || setup.state === "applying");
  useEffect(() => {
    if (!waiting) return;
    let cancel = false;
    const timer = setInterval(() => {
      fetchShopSetup(orderId).then((c) => { if (!cancel) setSetup(c.setup); }).catch(() => {});
    }, POLL_MS);
    return () => { cancel = true; clearInterval(timer); };
  }, [waiting, orderId]);

  const pack = cat?.packs.find((p) => p.id === packId) || null;
  const anyStation = pack ? pack.options.some((o) => (o.id === "kitchenTickets" || o.id === "barTill") && options[o.id]) : false;
  const advice = useMemo(
    () => adviseOnPlan(serviceId, Number(branches) || undefined, Number(staff) || undefined),
    [serviceId, branches, staff]
  );

  const choosePack = (p: SetupPack) => {
    setPackId(p.id);
    const style = p.defaultStyle || "";
    setStyleId(style);
    setOptions(recommended(p, style));
  };
  const chooseStyle = (id: string) => {
    if (!pack) return;
    setStyleId(id);
    setOptions(recommended(pack, id));
  };

  const send = async (body: Parameters<typeof saveShopSetup>[1]) => {
    setBusy(true);
    setError("");
    try {
      setSetup(await saveShopSetup(orderId, body));
    } catch (e) {
      setError(toUserMessage(e, "We couldn't save that. Please try again."));
    } finally {
      setBusy(false);
    }
  };

  const confirm = () => {
    if (!pack) return;
    const answers: SetupAnswers = { pack: pack.id, options };
    if (styleId) answers.style = styleId;
    const b = Math.floor(Number(branches));
    const s = Math.floor(Number(staff));
    if (b >= 1) answers.branches = b;
    if (s >= 1) answers.staff = s;
    send({ answers });
  };

  const shell = (children: React.ReactNode) => (
    <section className="mt-8 glass-card rounded-2xl p-5" aria-labelledby="shop-setup">{children}</section>
  );

  if (error && !cat) return null; // the questions are an extra: never get in the way of the shop itself
  if (!cat) return null;

  if (setup) {
    const done = setup.state === "applied";
    return shell(
      <>
        <h2 id="shop-setup" className="text-micro font-black uppercase text-slate-600 dark:text-slate-400">Your shop setup</h2>
        {setup.skipped ? (
          <p className="mt-3 text-sm font-semibold text-murzak-ink dark:text-slate-100">
            You skipped this, so your shop starts with the standard settings. You can change them inside your POS at any time.
          </p>
        ) : (
          <>
            <p className="mt-3 flex items-center gap-2 text-sm font-black text-murzak-ink dark:text-slate-100">
              {done ? <Check size={16} className="text-emerald-600" aria-hidden="true" /> : <Loader2 size={16} className="animate-spin" aria-hidden="true" />}
              {done ? "Done. Your shop is set up for your business." : setup.state === "failed" ? "Saved, but not applied yet." : "Saved. We'll apply this as soon as your shop is ready."}
            </p>
            <ul className="mt-3 space-y-1.5 list-disc pl-5 text-sm font-semibold text-slate-600 dark:text-slate-300">
              {setup.summary.map((line) => <li key={line}>{line}</li>)}
            </ul>
            {setup.state === "failed" && (
              <p className="mt-3 text-sm font-semibold text-slate-600 dark:text-slate-300">
                We could not apply this automatically. Your shop works as normal; message us from your portal and we will finish it for you.
              </p>
            )}
            {done && setup.notes.length > 0 && (
              <ul className="mt-3 space-y-1.5 list-disc pl-5 text-sm font-semibold text-slate-600 dark:text-slate-300">
                {setup.notes.map((line) => <li key={line}>{line}</li>)}
              </ul>
            )}
          </>
        )}
      </>
    );
  }

  return shell(
    <>
      <h2 id="shop-setup" className="text-micro font-black uppercase text-slate-600 dark:text-slate-400">Set up your shop for your business</h2>
      <p className="mt-2 text-sm font-semibold text-slate-600 dark:text-slate-400">
        While your shop builds, tell us about your business and we will set it up to suit. It takes about a minute.
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-3" role="radiogroup" aria-label="What kind of business is it?">
        {cat.packs.map((p) => (
          <button
            key={p.id}
            type="button"
            role="radio"
            aria-checked={packId === p.id}
            onClick={() => choosePack(p)}
            className={`text-left rounded-2xl border p-4 transition ${
              packId === p.id
                ? "border-murzak-accent bg-murzak-accent/10"
                : "border-slate-200 dark:border-white/15 hover:border-murzak-accent/60"
            }`}
          >
            <span className="text-murzak-ink dark:text-slate-100">{ICONS[p.id]}</span>
            <span className="mt-2 block font-black text-murzak-ink dark:text-slate-100">{p.label}</span>
            <span className="mt-1 block text-xs font-semibold text-slate-500 dark:text-slate-400">{p.blurb}</span>
          </button>
        ))}
      </div>

      {pack && (
        <div className="mt-6 space-y-5">
          {pack.styles.length > 0 && (
            <fieldset>
              <legend className="font-black text-murzak-ink dark:text-slate-100">Which describes you best?</legend>
              <div className="mt-2 space-y-2">
                {pack.styles.map((s) => (
                  <label key={s.id} className="flex items-start gap-3 text-sm font-semibold text-murzak-ink dark:text-slate-100">
                    <input type="radio" name="style" className="mt-1" checked={styleId === s.id} onChange={() => chooseStyle(s.id)} />
                    <span>{s.label}<span className="block text-xs text-slate-500 dark:text-slate-400">{s.blurb}</span></span>
                  </label>
                ))}
              </div>
            </fieldset>
          )}

          <div className="flex flex-wrap gap-6">
            <label className="text-sm font-black text-murzak-ink dark:text-slate-100">
              How many shops or branches?
              <input className={`mt-1 block ${fieldClass}`} inputMode="numeric" value={branches} onChange={(e) => setBranches(e.target.value.replace(/\D/g, "").slice(0, 2))} />
            </label>
            <label className="text-sm font-black text-murzak-ink dark:text-slate-100">
              How many staff will sign in?
              <input className={`mt-1 block ${fieldClass}`} inputMode="numeric" value={staff} onChange={(e) => setStaff(e.target.value.replace(/\D/g, "").slice(0, 3))} />
            </label>
          </div>
          {advice.message && (
            <p role="status" className="rounded-xl border border-orange-500/30 bg-orange-500/5 p-3 text-sm font-semibold text-slate-700 dark:text-slate-300">{advice.message}</p>
          )}

          {pack.options.length > 0 ? (
            <fieldset>
              <legend className="font-black text-murzak-ink dark:text-slate-100">Our recommendation. Change anything that does not fit.</legend>
              <div className="mt-2 space-y-3">
                {pack.options.map((o) => {
                  const off = o.needsStation && !anyStation;
                  return (
                    <label key={o.id} className={`flex items-start gap-3 text-sm font-semibold text-murzak-ink dark:text-slate-100 ${off ? "opacity-50" : ""}`}>
                      <input
                        type="checkbox"
                        className="mt-1"
                        disabled={off}
                        checked={!off && options[o.id] === true}
                        onChange={(e) => setOptions((cur) => ({ ...cur, [o.id]: e.target.checked }))}
                      />
                      <span>{o.label}<span className="block text-xs text-slate-500 dark:text-slate-400">{o.help}</span></span>
                    </label>
                  );
                })}
              </div>
            </fieldset>
          ) : (
            <div>
              <p className="font-black text-murzak-ink dark:text-slate-100">What we will set up</p>
              <ul className="mt-2 space-y-1.5 list-disc pl-5 text-sm font-semibold text-slate-600 dark:text-slate-300">
                {pack.includes.map((line) => <li key={line}>{line}</li>)}
              </ul>
            </div>
          )}

          <button
            type="button"
            onClick={confirm}
            disabled={busy}
            className="w-full inline-flex items-center justify-center gap-2 px-6 py-3 rounded-2xl font-black bg-murzak-accent text-murzak-ink disabled:opacity-60"
          >
            {busy && <Loader2 size={16} className="animate-spin" aria-hidden="true" />} Looks right, set it up
          </button>
        </div>
      )}

      {error && <p role="alert" className="mt-3 text-sm font-bold text-red-600">{error}</p>}
      <p className="mt-4 text-sm font-semibold text-slate-500 dark:text-slate-400">
        Not sure?{" "}
        <button type="button" disabled={busy} onClick={() => send({ skip: true })} className={linkClass}>Skip for now</button>
        {" "}and your shop starts with the standard settings. You can change everything later from inside your POS
        {advice.suggestedPlan ? <>, or <Link to="/portal/overview" className={linkClass}>review your plan</Link></> : null}.
      </p>
    </>
  );
};

export default ShopSetupCard;
