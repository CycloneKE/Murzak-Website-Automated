import React from "react";

interface PanelProps {
  title?: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  tone?: "default" | "danger";
  /** Drop the body padding, e.g. when the panel wraps a table. */
  flush?: boolean;
  className?: string;
  children?: React.ReactNode;
}

/** The portal's one surface: a flat panel with a hairline border. */
export default function Panel({ title, description, actions, tone = "default", flush, className = "", children }: PanelProps) {
  const border = tone === "danger" ? "border-p-danger/40" : "border-p-border";
  return (
    <section data-p="panel" className={`rounded-lg border ${border} bg-p-panel ${className}`}>
      {(title || actions) && (
        <header className={`flex flex-wrap items-start justify-between gap-3 px-4 sm:px-5 py-3.5 border-b ${border}`}>
          <div className="min-w-0">
            {title && (
              <h2 className={`text-sm font-semibold ${tone === "danger" ? "text-p-danger" : "text-p-text"}`}>{title}</h2>
            )}
            {description && <p className="mt-0.5 text-[13px] text-p-muted">{description}</p>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2 shrink-0">{actions}</div>}
        </header>
      )}
      {children !== undefined && children !== null && (
        <div className={flush ? "" : "p-4 sm:p-5"}>{children}</div>
      )}
    </section>
  );
}
