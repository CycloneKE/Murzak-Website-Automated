import React from "react";

export interface SectionNavItem {
  id: string;
  label: string;
  icon: React.ReactNode;
  tone?: "danger";
}

interface SectionNavProps {
  label: string;
  items: SectionNavItem[];
  active: string;
  onSelect: (id: string) => void;
  /** The sidebar already shows these on desktop, so only show the tab strip below lg. */
  stripOnly?: boolean;
}

/**
 * A page's own section menu: a vertical list at lg and up, a horizontally
 * scrolling tab row below.
 */
export default function SectionNav({ label, items, active, onSelect, stripOnly }: SectionNavProps) {
  return (
    <nav aria-label={label} data-p="sectionnav" className={stripOnly ? "lg:hidden" : "lg:w-52 lg:shrink-0"}>
      <ul className="flex lg:flex-col gap-1 overflow-x-auto [scrollbar-width:none] lg:overflow-visible -mx-4 px-4 sm:-mx-6 sm:px-6 lg:mx-0 lg:px-0 pb-2 lg:pb-0 border-b border-p-border lg:border-b-0">
        {items.map((it) => {
          const on = it.id === active;
          const danger = it.tone === "danger";
          return (
            <li key={it.id} className={`shrink-0 ${danger ? "lg:mt-2 lg:pt-2 lg:border-t lg:border-p-border" : ""}`}>
              <button
                type="button"
                onClick={() => onSelect(it.id)}
                aria-current={on ? "page" : undefined}
                className={`p-tap w-full flex items-center gap-2.5 rounded-md px-2.5 text-sm whitespace-nowrap text-left transition-colors [&>svg]:w-4 [&>svg]:h-4 [&>svg]:shrink-0
                  ${on
                    ? "bg-p-accent-soft text-p-text font-medium"
                    : danger
                      ? "text-p-danger hover:bg-p-danger-soft"
                      : "text-p-muted hover:text-p-text hover:bg-p-panel-2"}`}
              >
                {it.icon}
                {it.label}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
