import { useState, useEffect } from "react";
import { themes, defaultTheme, type Theme } from "./lib/themes";
import { Titlebar } from "./components/Titlebar";
import { Sidebar } from "./components/Sidebar";
import { TerminalPanel } from "./components/TerminalPanel";
import { SettingsModal } from "./components/SettingsModal";

interface PendingUpdate {
  version: string;
}

export default function App() {
  const [theme, setTheme] = useState<Theme>(defaultTheme);
  const [sidebarWidth, setSidebarWidth] = useState(220);
  const [workdir, setWorkdir] = useState<string>("");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [pendingUpdate, setPendingUpdate] = useState<PendingUpdate | null>(null);
  const [sessionRefreshKey, setSessionRefreshKey] = useState(0);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme.id);
  }, [theme.id]);

  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) return;
    const checkUpdate = async () => {
      try {
        const { check } = await import("@tauri-apps/plugin-updater");
        const update = await check();
        if (update?.available) {
          setPendingUpdate({ version: update.version });
        }
      } catch {
        // silent
      }
    };
    const t = setTimeout(checkUpdate, 3000);
    return () => clearTimeout(t);
  }, []);

  const handleWorkdirChange = (path: string) => {
    setWorkdir(path);
    setSessionId(null); // fresh session when switching projects
  };

  const handleSessionSelect = (id: string | null) => {
    setSessionId(id);
  };

  const handlePtyExit = () => {
    // Refresh sessions list so newly created sessions appear
    setSessionRefreshKey((k) => k + 1);
  };

  return (
    <div className="flex flex-col h-full w-full" style={{ background: "var(--bg)" }}>
      <Titlebar
        theme={theme}
        themes={themes}
        onThemeChange={(id) => setTheme(themes.find((t) => t.id === id) ?? theme)}
        onOpenSettings={() => setShowSettings(true)}
        updateAvailable={pendingUpdate}
      />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar
          width={sidebarWidth}
          onWidthChange={setSidebarWidth}
          workdir={workdir}
          onWorkdirChange={handleWorkdirChange}
          sessionId={sessionId}
          onSessionSelect={handleSessionSelect}
          sessionRefreshKey={sessionRefreshKey}
        />
        <div className="flex-1 overflow-hidden" style={{ borderLeft: "1px solid var(--border)" }}>
          <TerminalPanel
            theme={theme}
            workdir={workdir}
            sessionId={sessionId}
            onPtyExit={handlePtyExit}
          />
        </div>
      </div>

      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
    </div>
  );
}
