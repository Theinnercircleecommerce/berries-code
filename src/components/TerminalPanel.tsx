import { useEffect, useRef, useState, useCallback } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { RotateCcw, ImageIcon } from "lucide-react";
import type { Theme } from "../lib/themes";
import "@xterm/xterm/css/xterm.css";

interface Props {
  theme: Theme;
  workdir: string;
  sessionId: string | null;
  onPtyExit?: () => void;
}

export function TerminalPanel({ theme, workdir, sessionId, onPtyExit }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTerm | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const initializedRef = useRef(false);
  const prevWorkdirRef = useRef<string>("");
  const prevSessionRef = useRef<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [status, setStatus] = useState<"starting" | "running" | "exited">("starting");

  const startPty = useCallback(async (term: XTerm) => {
    setStatus("starting");
    try {
      const { rows, cols } = term;
      await invoke("pty_create", {
        rows,
        cols,
        workdir: workdir || null,
        session_id: sessionId || null,
      });
      setStatus("running");
    } catch (err) {
      term.write(`\r\n\x1b[31mFailed to start Claude Code: ${err}\x1b[0m\r\n`);
      term.write(`\x1b[33mMake sure 'claude' is installed: npm install -g @anthropic-ai/claude-code\x1b[0m\r\n`);
      setStatus("exited");
    }
  }, [workdir, sessionId]);

  // Initial mount — create terminal once
  useEffect(() => {
    if (!containerRef.current || initializedRef.current) return;
    initializedRef.current = true;

    const term = new XTerm({
      theme: theme.xterm,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      fontSize: 14,
      lineHeight: 1.4,
      cursorBlink: true,
      cursorStyle: "bar",
      allowTransparency: true,
      scrollback: 10000,
      macOptionIsMeta: true,
    });

    const fitAddon = new FitAddon();
    const linksAddon = new WebLinksAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(linksAddon);
    term.open(containerRef.current);

    requestAnimationFrame(() => { fitAddon.fit(); });

    termRef.current = term;
    fitRef.current = fitAddon;

    startPty(term);

    const unlistenData = listen<number[]>("pty-data", (e) => {
      term.write(new Uint8Array(e.payload));
    });

    const unlistenExit = listen("pty-exit", () => {
      term.write("\r\n\x1b[33m[Process exited — click Restart to reconnect]\x1b[0m\r\n");
      setStatus("exited");
      onPtyExit?.();
    });

    term.onData((data) => {
      const bytes = Array.from(new TextEncoder().encode(data));
      invoke("pty_write", { data: bytes }).catch(() => {});
    });

    term.onBinary((data) => {
      const bytes = Array.from(data.split("").map((c) => c.charCodeAt(0)));
      invoke("pty_write", { data: bytes }).catch(() => {});
    });

    const observer = new ResizeObserver(() => {
      requestAnimationFrame(() => {
        fitAddon.fit();
        const { rows, cols } = term;
        invoke("pty_resize", { rows, cols }).catch(() => {});
      });
    });
    if (containerRef.current) observer.observe(containerRef.current);

    const onInsertPath = (e: Event) => {
      const path = (e as CustomEvent).detail as string;
      const bytes = Array.from(new TextEncoder().encode(path));
      invoke("pty_write", { data: bytes }).catch(() => {});
      term.focus();
    };
    window.addEventListener("insert-path", onInsertPath);

    return () => {
      observer.disconnect();
      window.removeEventListener("insert-path", onInsertPath);
      unlistenData.then((fn) => fn());
      unlistenExit.then((fn) => fn());
      invoke("pty_kill").catch(() => {});
      term.dispose();
      initializedRef.current = false;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Update xterm theme when theme prop changes
  useEffect(() => {
    if (termRef.current) {
      termRef.current.options.theme = theme.xterm;
    }
  }, [theme]);

  // Restart PTY when workdir or sessionId changes
  useEffect(() => {
    if (!termRef.current || !initializedRef.current) return;

    const workdirChanged = prevWorkdirRef.current !== workdir;
    const sessionChanged = prevSessionRef.current !== sessionId;

    if (!workdirChanged && !sessionChanged) return;

    prevWorkdirRef.current = workdir;
    prevSessionRef.current = sessionId;

    // Skip on initial mount (handled above)
    if (!workdir && !sessionId && !workdirChanged) return;

    invoke("pty_kill").catch(() => {});
    termRef.current.clear();

    if (sessionId) {
      termRef.current.writeln(`\x1b[33m→ Resuming session…\x1b[0m`);
    } else if (workdirChanged && workdir) {
      termRef.current.writeln(`\x1b[33m→ Switching to ${workdir}\x1b[0m`);
    } else {
      termRef.current.writeln(`\x1b[33m→ Starting new conversation…\x1b[0m`);
    }

    startPty(termRef.current).then(() => termRef.current?.focus());
  }, [workdir, sessionId, startPty]);

  const restart = async () => {
    if (!termRef.current) return;
    await invoke("pty_kill").catch(() => {});
    termRef.current.clear();
    await startPty(termRef.current);
    termRef.current.focus();
  };

  // Drag-and-drop image/file support
  const onDragOver = (e: React.DragEvent) => { e.preventDefault(); setIsDragging(true); };
  const onDragLeave = () => setIsDragging(false);
  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const files = Array.from(e.dataTransfer.files);
    if (!files.length || !termRef.current) return;
    for (const file of files) {
      const filePath = (file as unknown as { path?: string }).path ?? file.name;
      const bytes = Array.from(new TextEncoder().encode(filePath));
      await invoke("pty_write", { data: bytes }).catch(() => {});
    }
    termRef.current.focus();
  };

  return (
    <div className="flex flex-col h-full" style={{ background: "var(--bg)" }}>
      {/* Toolbar */}
      <div
        className="flex items-center justify-between px-3 flex-shrink-0"
        style={{ height: "32px", borderBottom: "1px solid var(--border)", background: "var(--sidebar)" }}
      >
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium" style={{ color: "var(--subtext)" }}>
            Claude Code
          </span>
          <span
            className="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded"
            style={{
              background: status === "running"
                ? "color-mix(in srgb, var(--green) 20%, transparent)"
                : status === "exited"
                ? "color-mix(in srgb, var(--red) 20%, transparent)"
                : "color-mix(in srgb, var(--yellow) 20%, transparent)",
              color: status === "running" ? "var(--green)" : status === "exited" ? "var(--red)" : "var(--yellow)",
            }}
          >
            <span
              className="w-1.5 h-1.5 rounded-full"
              style={{
                background: status === "running" ? "var(--green)" : status === "exited" ? "var(--red)" : "var(--yellow)",
              }}
            />
            {status}
          </span>
        </div>

        <div className="flex items-center gap-1">
          <span
            className="flex items-center gap-1 text-xs px-2 py-1 rounded"
            style={{ color: "var(--muted)" }}
            title="Drag & drop images onto the terminal"
          >
            <ImageIcon size={11} />
            <span>drop images</span>
          </span>
          <button
            onClick={restart}
            className="flex items-center gap-1.5 text-xs px-2 py-1 rounded transition-colors"
            style={{ color: "var(--subtext)" }}
            onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.color = "var(--text)")}
            onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.color = "var(--subtext)")}
            title="Restart Claude Code"
          >
            <RotateCcw size={12} />
            Restart
          </button>
        </div>
      </div>

      {/* Terminal */}
      <div
        className={`flex-1 relative overflow-hidden ${isDragging ? "drop-active" : ""}`}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        style={{ padding: "8px" }}
      >
        <div ref={containerRef} className="h-full w-full" />
      </div>
    </div>
  );
}
