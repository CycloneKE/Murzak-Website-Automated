import React from "react";

interface FieldProps {
  label: React.ReactNode;
  hint?: React.ReactNode;
  error?: React.ReactNode;
  htmlFor?: string;
  children: React.ReactNode;
}

/** Label-above-field form row. */
export default function Field({ label, hint, error, htmlFor, children }: FieldProps) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block text-[13px] font-medium text-p-text">
        {label}
      </label>
      {children}
      {error ? (
        <p role="alert" className="text-[13px] text-p-danger">{error}</p>
      ) : hint ? (
        <p className="text-[13px] text-p-muted">{hint}</p>
      ) : null}
    </div>
  );
}

/** Shared classes for text inputs, selects and textareas inside the portal. */
export const inputClass =
  "w-full p-tap rounded-md border border-p-border bg-p-panel px-3 text-sm text-p-text placeholder:text-p-muted/70 " +
  "focus:border-p-accent focus:outline-none focus:ring-2 focus:ring-p-accent/25 disabled:bg-p-panel-2 disabled:text-p-muted";
