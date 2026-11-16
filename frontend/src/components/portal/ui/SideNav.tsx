import React from "react";
import { PanelLeft, Search, X } from "lucide-react";
import Logo from "../../Logo";

export interface SideNavItem {
  id: string;
  label: string;
  icon: React.ReactNode;
  badge?: number;
}
export interface SideNavGroup {
  id: string;
  label?: string;
  items: SideNavItem[];
}

interface SideNavProps {
  groups: SideNavGroup[];
  activeId: string;
  onSelect: (id: string) => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onSearch: () => void;
  /** Drawer state below lg. */
  open: boolean;
  onClose: () => void;
  footer: React.ReactNode;
}

/**
 * Compact grouped sidebar. 232px wide, 64px when collapsed to an icon rail.
 * Below lg it is a drawer and is never collapsed.
 */
export default function SideNav({
  groups, activeId, onSelect, collapsed, onToggleCollapsed, onSearch, open, onClose, footer,
}: SideNavProps) {
  // The rail only exists on desktop; the drawer always shows labels.
  const rail = collapsed ? "lg:w-16" : "lg:w-58";
  const hideOnRail = collapsed ? "lg:hidden" : "";

  return (
    <>
      {open && (
        <button
          type="button"
          aria-label="Close menu"
          className="fixed inset-0 z-90 bg-black/50 lg:hidden"
          onClick={onClose}
        />
      )}
      <aside
        data-p="sidenav"
        data-collapsed={collapsed ? "true" : "false"}
        className={`fixed inset-y-0 left-0 z-100 w-64 ${rail} flex flex-col border-r border-p-border bg-p-sidebar
          transition-transform duration-200 lg:translate-x-0 ${open ? "translate-x-0" : "-translate-x-full"}`}
      >
        <div className={`flex items-center h-14 px-4 gap-2 ${collapsed ? "lg:justify-center lg:px-0" : ""}`}>
          <span className={`min-w-0 grow ${hideOnRail}`}>
            <Logo />
          </span>
          {collapsed && (
            <span className="hidden lg:flex w-8 h-8 rounded-md bg-p-accent text-p-accent-fg items-center justify-center font-semibold">
              M
            </span>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close menu"
            className="lg:hidden p-2 rounded-md text-p-muted hover:text-p-text hover:bg-p-panel-2"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className={`px-3 pb-2 ${collapsed ? "lg:px-2" : ""}`}>
          <button
            type="button"
            onClick={onSearch}
            aria-label="Search"
            title="Search (Ctrl+K)"
            className={`w-full p-tap flex items-center gap-2 rounded-md border border-p-border bg-p-panel px-2.5 text-[13px] text-p-muted hover:border-p-border-strong ${collapsed ? "lg:justify-center lg:px-0" : ""}`}
          >
            <Search className="w-4 h-4 shrink-0" />
            <span className={`grow text-left ${hideOnRail}`}>Search</span>
            <kbd className={`font-mono text-[11px] px-1.5 py-0.5 rounded border border-p-border bg-p-panel-2 ${hideOnRail} hidden sm:inline`}>
              Ctrl K
            </kbd>
          </button>
        </div>

        <nav aria-label="Portal" className={`grow overflow-y-auto px-3 pb-3 ${collapsed ? "lg:px-2" : ""}`}>
          {groups.map((group) => (
            <div key={group.id} className="mt-3 first:mt-1">
              {group.label && (
                <p
                  data-p="nav-group"
                  className={`px-2 mb-1 text-[11px] font-semibold uppercase tracking-wider text-p-muted ${hideOnRail}`}
                >
                  {group.label}
                </p>
              )}
              {group.label && collapsed && <div className="hidden lg:block mx-2 mb-2 border-t border-p-border" />}
              <ul className="space-y-0.5">
                {group.items.map((item) => {
                  const active = item.id === activeId;
                  return (
                    <li key={item.id}>
                      <button
                        type="button"
                        onClick={() => onSelect(item.id)}
                        aria-current={active ? "page" : undefined}
                        title={collapsed ? item.label : undefined}
                        className={`relative w-full p-tap flex items-center gap-2.5 rounded-md px-2 text-sm text-left transition-colors
                          ${collapsed ? "lg:justify-center lg:px-0" : ""}
                          ${active ? "bg-p-accent-soft text-p-text font-medium" : "text-p-muted hover:text-p-text hover:bg-p-panel-2"}`}
                      >
                        <span
                          className={`shrink-0 w-7 h-7 rounded-md border flex items-center justify-center [&>svg]:w-4 [&>svg]:h-4
                            ${active ? "border-transparent bg-p-accent text-p-accent-fg" : "border-p-border bg-p-panel text-p-muted"}`}
                        >
                          {item.icon}
                        </span>
                        <span className={`grow truncate ${hideOnRail}`}>{item.label}</span>
                        {!!item.badge && (
                          <span
                            className={`shrink-0 min-w-5 h-5 px-1.5 rounded-full bg-p-danger text-white text-[11px] font-semibold inline-flex items-center justify-center
                              ${collapsed ? "lg:absolute lg:-top-0.5 lg:right-0.5 lg:min-w-4 lg:h-4 lg:px-1 lg:text-[10px]" : ""}`}
                            aria-label={`${item.badge} unread`}
                          >
                            {item.badge > 99 ? "99+" : item.badge}
                          </span>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        <div className={`border-t border-p-border p-3 flex items-center gap-2 ${collapsed ? "lg:flex-col lg:px-2" : ""}`}>
          <div className={`min-w-0 grow ${collapsed ? "lg:grow-0" : ""}`}>{footer}</div>
          <button
            type="button"
            onClick={onToggleCollapsed}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-pressed={collapsed}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className="hidden lg:inline-flex shrink-0 p-2 rounded-md text-p-muted hover:text-p-text hover:bg-p-panel-2"
          >
            <PanelLeft className="w-4 h-4" />
          </button>
        </div>
      </aside>
    </>
  );
}
