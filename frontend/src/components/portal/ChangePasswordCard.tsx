import React, { useState } from "react";
import { Lock, RefreshCw, ShieldCheck, AlertCircle, Eye, EyeOff } from "lucide-react";

const ChangePasswordCard: React.FC = () => {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [show, setShow] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const inputCls =
    "w-full bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl pl-11 pr-11 py-3.5 text-sm font-semibold text-murzak-navy dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-murzak-cyan transition";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccess("");

    if (newPassword.length < 8) {
      setError("New password must be at least 8 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("New password and confirmation do not match.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Could not update password.");

      setSuccess(data?.message || "Password updated successfully.");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err: any) {
      setError(err?.message || "Could not update password.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="bg-white/55 dark:bg-murzak-navy/60 backdrop-blur-md sm:backdrop-blur-xl border border-slate-100 dark:border-white/5 p-6 sm:p-8 lg:p-10 rounded-[2.25rem] sm:rounded-[3rem] shadow-lg sm:shadow-xl">
      <h3 className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-8 flex items-center gap-2">
        <Lock size={14} className="text-murzak-cyan" /> Security · Change Password
      </h3>

      {error && (
        <div className="mb-5 p-3.5 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 rounded-2xl text-red-600 text-[11px] font-bold flex items-center gap-2">
          <AlertCircle size={14} /> {error}
        </div>
      )}
      {success && (
        <div className="mb-5 p-3.5 bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20 rounded-2xl text-emerald-600 text-[11px] font-bold flex items-center gap-2">
          <ShieldCheck size={14} /> {success}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="relative">
          <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
          <input
            type={show ? "text" : "password"}
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            placeholder="Current password"
            autoComplete="current-password"
            className={inputCls}
          />
        </div>
        <div className="relative">
          <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
          <input
            type={show ? "text" : "password"}
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder="New password (min 8 characters)"
            autoComplete="new-password"
            className={inputCls}
          />
          <button
            type="button"
            onClick={() => setShow((s) => !s)}
            className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 rounded-lg text-slate-400 hover:text-murzak-cyan transition"
            aria-label={show ? "Hide passwords" : "Show passwords"}
          >
            {show ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </div>
        <div className="relative">
          <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
          <input
            type={show ? "text" : "password"}
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="Confirm new password"
            autoComplete="new-password"
            className={inputCls}
          />
        </div>

        <button
          type="submit"
          disabled={submitting || !currentPassword || !newPassword}
          className="w-full bg-murzak-navy dark:bg-murzak-cyan text-white dark:text-murzak-navy py-3.5 rounded-2xl font-black text-[10px] uppercase tracking-widest hover:scale-[1.01] transition-all flex items-center justify-center gap-2 disabled:opacity-50"
        >
          {submitting ? <RefreshCw size={14} className="animate-spin" /> : <ShieldCheck size={14} />}
          {submitting ? "Updating..." : "Update Password"}
        </button>
      </form>
    </div>
  );
};

export default ChangePasswordCard;
