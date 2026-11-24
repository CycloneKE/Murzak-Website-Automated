import React from "react";
import { Link } from "react-router-dom";
import { Menu } from "lucide-react";

export interface Crumb {
  label: string;
  to?: string;
}

interface TopBarProps {
  crumbs: Crumb[];
  status?: React.ReactNode;
  actions?: React.ReactNode;
  onOpenMenu: () => void;
}

/** Breadcrumb bar. The last crumb is the current page and never a link. */
export default function TopBar({ crumbs, status, actions, onOpenMenu }: TopBarProps) {
  return (
    <header
      data-p="topbar"
      className="sticky top-0 z-40 flex items-center gap-3 h-14 px-4 sm:px-6 border-b border-p-border bg-p-bg"
    >
      <button
        type="button"
        onClick={onOpenMenu}
        aria-label="Open menu"
        className="lg:hidden -ml-1.5 p-2 rounded-md text-p-muted hover:text-p-text hover:bg-p-panel-2"
      >
        <Menu className="w-5 h-5" />
      </button>

      <nav aria-label="Breadcrumb" className="min-w-0 grow">
        <ol className="flex items-center gap-2 text-sm min-w-0">
          {crumbs.map((c, i) => {
            const last = i === crumbs.length - 1;
            return (
              <li
                key={`${c.label}-${i}`}
                className={`flex items-center gap-2 ${last ? "min-w-0" : "shrink-0 hidden sm:flex"}`}
              >
                {i > 0 && <span className="text-p-muted/60 hidden sm:inline" aria-hidden>/</span>}
                {last || !c.to ? (
                  <span aria-current={last ? "page" : undefined} className={`truncate ${last ? "font-medium text-p-text" : "text-p-muted"}`}>
                    {c.label}
                  </span>
                ) : (
                  <Link to={c.to} className="text-p-muted hover:text-p-text">
                    {c.label}
                  </Link>
                )}
              </li>
            );
          })}
          {status && <li className="shrink-0">{status}</li>}
        </ol>
      </nav>

      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </header>
  );
}
