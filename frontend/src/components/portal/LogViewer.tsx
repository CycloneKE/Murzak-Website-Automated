import React, { useEffect, useMemo, useRef, useState } from "react";
import { Copy, Download, Search } from "lucide-react";
import { PButton, inputClass } from "./ui";

interface Props {
  /** Raw log text. ANSI colour codes are stripped for display. */
  logs: string;
  loading?: boolean;
  empty?: string;
  /** File name stem for Download. */
  filename?: string;
  heightClass?: string;
  /** Extra controls rendered next to the search box (e.g. a line-count select). */
  toolbar?: React.ReactNode;
  /** Keep the view pinned to the newest line. */
  follow?: boolean;
}

// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;]*[A-Za-z]/g;

/**
 * A log pane with find-in-logs, copy and download. Shared by deployment build
 * logs and runtime logs so both read the same way. Matching lines are
 * highlighted and, while a search is active, non-matching lines are dimmed
 * rather than removed so context around a hit is never lost.
 */
const LogViewer: React.FC<Props> = ({
  logs, loading, empty = "Nothing logged yet.", filename = "logs", heightClass = "max-h-[28rem]", toolbar, follow = true,
}) => {
  const [find, setFind] = useState("");
  const [copied, setCopied] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  const lines = useMemo(() => (logs || "").replace(ANSI, "").split(/\r?\n/), [logs]);
  const needle = find.trim().toLowerCase();
  const hits = needle ? lines.filter((l) => l.toLowerCase().includes(needle)).length : 0;

  useEffect(() => {
    if (follow && !needle) endRef.current?.scrollIntoView({ block: "end" });
  }, [logs, follow, needle]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard blocked: nothing useful to do */ }
  };

  const download = () => {
    const url = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/plain" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${filename}.log`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const has = !!logs && logs.trim().length > 0;

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <div className="relative grow min-w-[10rem]">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-p-muted pointer-events-none" />
          <input
            type="search"
            aria-label="Find in logs"
            placeholder="Find in logs"
            value={find}
            onChange={(e) => setFind(e.target.value)}
            className={`${inputClass} pl-9`}
          />
        </div>
        {needle && <span className="text-[13px] text-p-muted" aria-live="polite">{hits} match{hits === 1 ? "" : "es"}</span>}
        {toolbar}
        <PButton size="sm" icon={<Copy className="w-4 h-4" />} onClick={copy} disabled={!has}>{copied ? "Copied" : "Copy"}</PButton>
        <PButton size="sm" icon={<Download className="w-4 h-4" />} onClick={download} disabled={!has}>Download</PButton>
      </div>
      <div
        role="log"
        aria-label="Log output"
        tabIndex={0}
        className={`rounded-md border border-p-border bg-p-panel-2 p-3 overflow-auto font-mono text-xs leading-relaxed ${heightClass}`}
      >
        {loading ? (
          <p className="text-p-muted">Loading log…</p>
        ) : !has ? (
          <p className="text-p-muted">{empty}</p>
        ) : (
          lines.map((line, i) => {
            const match = needle && line.toLowerCase().includes(needle);
            return (
              <div
                key={i}
                className={`whitespace-pre-wrap break-words ${
                  needle ? (match ? "bg-p-warning-soft text-p-text" : "text-p-muted/60") : "text-p-text"
                }`}
              >
                {line || " "}
              </div>
            );
          })
        )}
        <div ref={endRef} />
      </div>
    </div>
  );
};

export default LogViewer;
