import React from "react";
import { ChevronRight } from "lucide-react";

export interface Column<T> {
  key: string;
  header: string;
  cell: (row: T) => React.ReactNode;
  /** The column shown as the card title on phones. */
  primary?: boolean;
  /** Right-align (amounts, actions). */
  align?: "right";
  className?: string;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  rowLabel?: (row: T) => string;
  empty: React.ReactNode;
}

/**
 * A table at md and up; stacked cards below. Rows are keyboard-activatable
 * when onRowClick is set.
 */
export default function DataTable<T>({ columns, rows, rowKey, onRowClick, rowLabel, empty }: DataTableProps<T>) {
  if (!rows.length) return <div className="p-4 sm:p-5">{empty}</div>;

  const primary = columns.find((c) => c.primary) || columns[0];
  const rest = columns.filter((c) => c !== primary);
  const activate = (row: T) => (e: React.KeyboardEvent) => {
    if (!onRowClick) return;
    if (e.target !== e.currentTarget) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onRowClick(row);
    }
  };
  // Buttons/links inside a row act on their own, not as a row click.
  const rowClick = (row: T) => (e: React.MouseEvent) => {
    if (!onRowClick) return;
    if ((e.target as HTMLElement).closest("button, a, input, select, label")) return;
    onRowClick(row);
  };

  return (
    <>
      <div className="hidden md:block overflow-x-auto">
        <table data-p="table" className="w-full text-sm table-fixed">
          <thead>
            <tr className="text-left text-xs text-p-muted">
              {columns.map((c) => (
                <th key={c.key} scope="col" className={`font-medium px-4 sm:px-5 py-2.5 border-b border-p-border ${c.align === "right" ? "text-right" : ""} ${c.className || ""}`}>
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={rowKey(row)}
                tabIndex={onRowClick ? 0 : undefined}
                aria-label={onRowClick && rowLabel ? rowLabel(row) : undefined}
                onClick={rowClick(row)}
                onKeyDown={activate(row)}
                className={`border-b border-p-border last:border-b-0 ${onRowClick ? "cursor-pointer hover:bg-p-panel-2" : ""}`}
              >
                {columns.map((c) => (
                  <td key={c.key} className={`px-4 sm:px-5 py-3 align-middle ${c.align === "right" ? "text-right" : ""} ${c.primary ? "font-medium text-p-text" : "text-p-muted"}`}>
                    <div className={c.align === "right" ? "flex justify-end" : "truncate"}>{c.cell(row)}</div>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="md:hidden divide-y divide-p-border">
        {rows.map((row) => (
          <li
            key={rowKey(row)}
            tabIndex={onRowClick ? 0 : undefined}
            role={onRowClick ? "button" : undefined}
            aria-label={onRowClick && rowLabel ? rowLabel(row) : undefined}
            onClick={rowClick(row)}
            onKeyDown={activate(row)}
            className={`px-4 py-3.5 ${onRowClick ? "cursor-pointer active:bg-p-panel-2" : ""}`}
          >
            <div className="flex items-center gap-2">
              <div className="min-w-0 grow font-medium text-p-text truncate">{primary.cell(row)}</div>
              {onRowClick && <ChevronRight className="w-4 h-4 shrink-0 text-p-muted" aria-hidden />}
            </div>
            <dl className="mt-2 space-y-1.5">
              {rest.map((c) => (
                <div key={c.key} className="flex items-center justify-between gap-3 text-[13px]">
                  <dt className="text-p-muted shrink-0">{c.header}</dt>
                  <dd className="min-w-0 truncate text-p-text text-right">{c.cell(row)}</dd>
                </div>
              ))}
            </dl>
          </li>
        ))}
      </ul>
    </>
  );
}
