import React, { useEffect, useRef, useState } from "react";
import { ChevronsUpDown, LogOut, Moon, Settings, Sun } from "lucide-react";

interface UserMenuProps {
  name: string;
  email?: string;
  plan: string;
  accountStatus?: string;
  theme: "light" | "dark";
  onToggleTheme: () => void;
  onSettings: () => void;
  onLogout: () => void;
  /** Icon-only trigger (collapsed sidebar). */
  compact?: boolean;
}

/** Account popover at the bottom of the sidebar. */
export default function UserMenu({
  name, email, plan, accountStatus, theme, onToggleTheme, onSettings, onLogout, compact,
}: UserMenuProps) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const initial = (name || "U").trim().charAt(0).toUpperCase();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const item =
    "w-full p-tap flex items-center gap-2.5 px-2.5 rounded-md text-sm text-left text-p-text hover:bg-p-panel-2";

  return (
    <div ref={wrap} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account menu"
        className={`w-full p-tap flex items-center gap-2.5 rounded-md border border-p-border bg-p-panel px-2 text-left hover:border-p-border-strong ${compact ? "lg:w-10 lg:justify-center lg:px-0" : ""}`}
      >
        <span className="shrink-0 w-6 h-6 rounded-full bg-p-accent-soft text-p-accent-text text-xs font-semibold flex items-center justify-center">
          {initial}
        </span>
        <span className={`min-w-0 grow truncate text-sm font-medium text-p-text ${compact ? "lg:hidden" : ""}`}>{name}</span>
        <ChevronsUpDown className={`w-3.5 h-3.5 shrink-0 text-p-muted ${compact ? "lg:hidden" : ""}`} />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute bottom-full left-0 mb-2 w-60 rounded-lg border border-p-border bg-p-panel shadow-xl p-1.5 z-10"
        >
          <div className="px-2.5 py-2 border-b border-p-border mb-1.5">
            <p className="text-sm font-medium text-p-text truncate">{name}</p>
            {email && <p className="text-xs text-p-muted truncate">{email}</p>}
            <p className="mt-1.5 text-xs text-p-muted">
              {plan}
              {accountStatus ? ` · ${accountStatus}` : ""}
            </p>
          </div>
          <button
            type="button"
            role="menuitemcheckbox"
            aria-checked={theme === "dark"}
            onClick={onToggleTheme}
            className={item}
          >
            {theme === "dark" ? <Sun className="w-4 h-4 text-p-muted" /> : <Moon className="w-4 h-4 text-p-muted" />}
            {theme === "dark" ? "Switch to light" : "Switch to dark"}
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onSettings();
            }}
            className={item}
          >
            <Settings className="w-4 h-4 text-p-muted" /> Settings
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={onLogout}
            className={`${item} !text-p-danger`}
          >
            <LogOut className="w-4 h-4" /> Log out
          </button>
        </div>
      )}
    </div>
  );
}
