import { Palette, Terminal, Settings } from "lucide-react";
import { useState, useRef, useEffect } from "react";
import type { Theme } from "../lib/themes";

interface Props {
  theme: Theme;
  themes: Theme[];
  onThemeChange: (id: string) => void;
  onOpenSettings: () => void;
  updateAvailable?: { version: string } | null;
}

export function Titlebar({ theme, themes, onThemeChange, onOpenSettings, updateAvailable }: Props) {
  const [showThemes, setShowThemes] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowThemes(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    // drag-region on the outer div — entire titlebar is draggable
    <div
      className="drag-region select-none flex-shrink-0"
      style={{
        height: "48px",
        background: "var(--titlebar)",
        borderBottom: "1px solid var(--border)",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        paddingLeft: "80px",
        paddingRight: "12px",
      }}
    >
      {/* Logo — sits inside drag region, not interactive */}
      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
        <Terminal size={14} style={{ color: "var(--accent)" }} />
        <span style={{ fontSize: "13px", fontWeight: 600, color: "var(--text)", letterSpacing: "-0.01em" }}>
          Berries Code
        </span>
      </div>

      {/* Interactive controls — no-drag so clicks work */}
      <div className="no-drag" style={{ display: "flex", alignItems: "center", gap: "4px" }}>

        {/* Theme picker */}
        <div style={{ position: "relative" }} ref={menuRef}>
          <button
            onClick={() => setShowThemes((v) => !v)}
            style={{
              display: "flex", alignItems: "center", gap: "6px",
              padding: "4px 8px", borderRadius: "6px", border: "none",
              background: showThemes ? "var(--surface)" : "transparent",
              color: "var(--subtext)", fontSize: "12px", cursor: "pointer",
            }}
          >
            <Palette size={13} />
            {theme.name}
          </button>

          {showThemes && (
            <div style={{
              position: "absolute", right: 0, top: "calc(100% + 4px)",
              background: "var(--surface)", border: "1px solid var(--border)",
              borderRadius: "10px", padding: "4px", minWidth: "130px",
              boxShadow: "0 8px 32px rgba(0,0,0,0.3)", zIndex: 100,
            }}>
              {themes.map((t) => (
                <button
                  key={t.id}
                  onClick={() => { onThemeChange(t.id); setShowThemes(false); }}
                  style={{
                    width: "100%", display: "flex", alignItems: "center", gap: "8px",
                    padding: "6px 10px", borderRadius: "6px", border: "none",
                    background: t.id === theme.id ? "var(--overlay)" : "transparent",
                    color: t.id === theme.id ? "var(--accent)" : "var(--text)",
                    fontSize: "12px", cursor: "pointer", textAlign: "left",
                  }}
                >
                  <span style={{ width: 10, height: 10, borderRadius: "50%", background: t.xterm.cursor, flexShrink: 0 }} />
                  {t.name}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Settings */}
        <button
          onClick={onOpenSettings}
          title="Settings"
          style={{
            position: "relative", width: "30px", height: "30px",
            display: "flex", alignItems: "center", justifyContent: "center",
            borderRadius: "6px", border: "none",
            background: "transparent", color: "var(--subtext)", cursor: "pointer",
          }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--surface)"; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
        >
          <Settings size={14} />
          {updateAvailable && (
            <span style={{
              position: "absolute", top: "5px", right: "5px",
              width: "7px", height: "7px", borderRadius: "50%",
              background: "var(--green)",
            }} />
          )}
        </button>
      </div>
    </div>
  );
}
