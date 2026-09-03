import React, { useEffect, useRef, useState } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { mintTerminalSession } from "../../services/terminal";
import { toUserMessage } from "../../services/errors";

interface TerminalViewProps {
  serviceId: string;
}

type ConnState = "connecting" | "open" | "closed" | "error";

/**
 * The actual interactive shell — P5.5. Everything before this (eligibility,
 * approval, disclosure) lives in DeveloperTerminalPanel; once all three are
 * satisfied, this mounts and does the real work: mint a single-use ticket,
 * open the WS, and pipe raw bytes between xterm.js and the backend's proxy
 * (which itself pipes to the broker — this component never talks to the
 * broker or Docker directly, and never sees a container name or id).
 */
const TerminalView: React.FC<TerminalViewProps> = ({ serviceId }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTerm | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const [state, setState] = useState<ConnState>("connecting");
  const [message, setMessage] = useState("");

  useEffect(() => {
    let cancelled = false;
    let ws: WebSocket | null = null;
    let resizeObserver: ResizeObserver | null = null;

    const term = new XTerm({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: '"JetBrains Mono", monospace',
      theme: { background: "#0a0a0a", foreground: "#d4d4d4" },
      scrollback: 2000,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    termRef.current = term;
    fitRef.current = fit;
    if (containerRef.current) {
      term.open(containerRef.current);
      fit.fit();
    }

    const connect = async () => {
      try {
        const { wsTicket, wsPath } = await mintTerminalSession(serviceId);
        if (cancelled) return;
        const scheme = window.location.protocol === "https:" ? "wss:" : "ws:";
        ws = new WebSocket(`${scheme}//${window.location.host}${wsPath}?ticket=${encodeURIComponent(wsTicket)}`);
        ws.binaryType = "arraybuffer";
        wsRef.current = ws;

        ws.onopen = () => {
          if (cancelled) return;
          setState("open");
        };
        ws.onmessage = (ev) => {
          if (cancelled) return;
          if (typeof ev.data === "string") {
            // Control frames only ever arrive as text; a real shell's own
            // output could coincidentally be valid JSON, so only treat it as
            // a control frame when it actually parses AND carries a known
            // `type` — otherwise it's real terminal output.
            try {
              const msg = JSON.parse(ev.data);
              if (msg && (msg.type === "ready" || msg.type === "notice" || msg.type === "error")) {
                if (msg.type === "error") {
                  setState("error");
                  setMessage(msg.message || "The developer terminal hit an error.");
                } else if (msg.type === "notice") {
                  term.writeln(`\x1b[90m${msg.message}\x1b[0m`);
                }
                return;
              }
            } catch {
              // not JSON — fall through to raw write
            }
          }
          term.write(typeof ev.data === "string" ? ev.data : new Uint8Array(ev.data as ArrayBuffer));
        };
        ws.onclose = () => {
          if (cancelled) return;
          setState((prev) => (prev === "error" ? prev : "closed"));
        };
        ws.onerror = () => {
          if (cancelled) return;
          setState("error");
          setMessage("Connection to the developer terminal failed.");
        };
      } catch (e: any) {
        if (!cancelled) {
          setState("error");
          setMessage(toUserMessage(e, "Could not start a developer terminal session."));
        }
      }
    };
    connect();

    const dataDisposable = term.onData((data) => {
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(data);
    });

    const sendResize = () => {
      fit.fit();
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
      }
    };
    if (containerRef.current && "ResizeObserver" in window) {
      resizeObserver = new ResizeObserver(sendResize);
      resizeObserver.observe(containerRef.current);
    }

    return () => {
      cancelled = true;
      dataDisposable.dispose();
      resizeObserver?.disconnect();
      try { ws?.close(); } catch {}
      term.dispose();
      termRef.current = null;
    };
  }, [serviceId]);

  return (
    <div className="rounded-2xl border border-white/10 bg-[#0a0a0a] overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2.5 bg-[#1a1a1a] border-b border-white/10">
        <span className="text-[11px] font-mono text-gray-400">developer terminal</span>
        <span
          className={`text-[10px] font-black uppercase tracking-widest ${
            state === "open" ? "text-murzak-success" : state === "error" ? "text-red-500" : "text-slate-500"
          }`}
        >
          {state === "connecting" ? "Connecting…" : state === "open" ? "Connected" : state === "error" ? "Error" : "Closed"}
        </span>
      </div>
      {(state === "error" || state === "closed") && message && (
        <p className="px-4 py-2 text-[12px] font-medium text-red-400 border-b border-white/10">{message}</p>
      )}
      <div ref={containerRef} className="p-2 h-[420px]" />
    </div>
  );
};

export default TerminalView;
