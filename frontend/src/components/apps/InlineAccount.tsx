import React, { useState } from "react";
import { Loader2 } from "lucide-react";
import { describeStatus, toUserMessage } from "../../services/errors";

interface InlineAccountProps {
  user: { email?: string; name?: string } | null;
  /** Shop name — /api/register requires a company. */
  companyHint: string;
  onSignedIn: (user: any) => void;
}

type Mode = "signup" | "signin";

const INPUT_CLASS =
  "w-full rounded-2xl px-5 py-3.5 font-bold bg-white/70 dark:bg-white/5 border border-slate-200 dark:border-murzak-border text-murzak-ink dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-hidden focus:ring-2 focus:ring-murzak-accent";

const InlineAccount: React.FC<InlineAccountProps> = ({ user, companyHint, onSignedIn }) => {
  const [mode, setMode] = useState<Mode>("signup");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (user) {
    return (
      <p className="text-sm font-semibold text-slate-600 dark:text-slate-400">
        Signed in as <span className="font-black text-murzak-ink dark:text-slate-100">{user.email || user.name}</span> ·{" "}
        <a href="/login" className="text-murzak-accent font-black underline underline-offset-2">not you?</a>
      </p>
    );
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const cleanName = name.trim();
    if (mode === "signup" && !cleanName) {
      setError("Please enter your name.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await fetch(mode === "signup" ? "/api/register" : "/api/login", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          mode === "signup"
            // /api/register rejects an empty company ("Missing required fields."),
            // so fall back to the person's (non-empty, trimmed) name.
            ? { name: cleanName, company: companyHint.trim() || cleanName, email: email.trim(), password, purpose: "Murzak POS", plan: "None" }
            : { email: email.trim(), password }
        ),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 409 && mode === "signup" && /already|in use|exists/i.test(String(data?.error || ""))) {
        setMode("signin");
        setError("You already have an account with that email — sign in below.");
        return;
      }
      if (!res.ok) throw new Error(data?.error || describeStatus(res.status));
      onSignedIn(data.user);
    } catch (err: any) {
      setError(toUserMessage(err, mode === "signup" ? "We couldn't create your account." : "We couldn't sign you in."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-3">
      {mode === "signup" && (
        <input aria-label="Your name" required value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" autoComplete="name" className={INPUT_CLASS} />
      )}
      <input aria-label="Email" required type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" autoComplete={mode === "signup" ? "email" : "username"} className={INPUT_CLASS} />
      <input
        aria-label="Password"
        required
        type="password"
        minLength={mode === "signup" ? 8 : undefined}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder={mode === "signup" ? "Create a password (8+ characters)" : "Password"}
        autoComplete={mode === "signup" ? "new-password" : "current-password"}
        className={INPUT_CLASS}
      />
      {error && <p className="text-sm font-bold text-red-600 dark:text-red-400" role="alert">{error}</p>}
      <button
        type="submit"
        disabled={busy}
        className="w-full px-6 py-3.5 rounded-2xl font-black text-sm border border-slate-300 dark:border-murzak-border text-murzak-ink dark:text-slate-100 inline-flex items-center justify-center gap-2 disabled:opacity-50"
      >
        {busy && <Loader2 size={16} className="animate-spin" />}
        {mode === "signup" ? "Create my account" : "Sign in"}
      </button>
      <p className="text-sm font-semibold text-slate-500 dark:text-slate-400">
        {mode === "signup" ? "Already have an account? " : "New to Murzak? "}
        <button
          type="button"
          onClick={() => { setMode(mode === "signup" ? "signin" : "signup"); setError(""); }}
          className="text-murzak-accent font-black underline underline-offset-2"
        >
          {mode === "signup" ? "Sign in" : "Create an account"}
        </button>
      </p>
    </form>
  );
};

export default InlineAccount;
