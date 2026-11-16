import React, { useState } from "react";
import { ShieldCheck, AlertCircle, Eye, EyeOff } from "lucide-react";
import { Field, Panel, PButton, inputClass } from "./ui";
import { toUserMessage } from "../../services/errors";

const ChangePasswordCard: React.FC = () => {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [show, setShow] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

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
      setError(toUserMessage(err, "Could not update password."));
    } finally {
      setSubmitting(false);
    }
  };

  const type = show ? "text" : "password";

  return (
    <Panel
      title="Change password"
      actions={
        <PButton
          size="sm"
          icon={show ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
          onClick={() => setShow((v) => !v)}
          aria-label={show ? "Hide passwords" : "Show passwords"}
          aria-pressed={show}
        >
          {show ? "Hide" : "Show"}
        </PButton>
      }
    >
      {error && (
        <p role="alert" className="mb-4 flex items-center gap-2 text-[13px] text-p-danger">
          <AlertCircle size={14} /> {error}
        </p>
      )}
      {success && (
        <p role="status" className="mb-4 flex items-center gap-2 text-[13px] text-p-success">
          <ShieldCheck size={14} /> {success}
        </p>
      )}

      <form onSubmit={handleSubmit} className="space-y-4 max-w-md">
        <Field label="Current password" htmlFor="pw-current">
          <input
            id="pw-current"
            type={type}
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            autoComplete="current-password"
            className={inputClass}
          />
        </Field>
        <Field label="New password" hint="At least 8 characters." htmlFor="pw-new">
          <input
            id="pw-new"
            type={type}
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            autoComplete="new-password"
            className={inputClass}
          />
        </Field>
        <Field label="Confirm new password" htmlFor="pw-confirm">
          <input
            id="pw-confirm"
            type={type}
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            autoComplete="new-password"
            className={inputClass}
          />
        </Field>
        <PButton type="submit" variant="primary" loading={submitting} disabled={!currentPassword || !newPassword}>
          {submitting ? "Updating..." : "Update password"}
        </PButton>
      </form>
    </Panel>
  );
};

export default ChangePasswordCard;
