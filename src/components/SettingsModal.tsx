import { useState, useEffect } from "react";
import { X, RefreshCw, Download, CheckCircle, AlertCircle, Loader } from "lucide-react";

type UpdateStatus =
  | { state: "idle" }
  | { state: "checking" }
  | { state: "up-to-date" }
  | { state: "available"; version: string; onInstall: () => Promise<void> }
  | { state: "downloading" }
  | { state: "error"; message: string };

interface Props {
  onClose: () => void;
}

export function SettingsModal({ onClose }: Props) {
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>({ state: "idle" });
  const [appVersion, setAppVersion] = useState("…");

  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) return;
    import("@tauri-apps/api/app").then(({ getVersion }) =>
      getVersion().then(setAppVersion).catch(() => setAppVersion("unknown"))
    );
  }, []);

  const checkForUpdates = async () => {
    setUpdateStatus({ state: "checking" });
    try {
      const { check } = await import("@tauri-apps/plugin-updater");
      const { relaunch } = await import("@tauri-apps/plugin-process");
      const update = await check();
      if (update?.available) {
        setUpdateStatus({
          state: "available",
          version: update.version,
          onInstall: async () => {
            setUpdateStatus({ state: "downloading" });
            await update.downloadAndInstall();
            await relaunch();
          },
        });
      } else {
        setUpdateStatus({ state: "up-to-date" });
      }
    } catch (e) {
      const msg = String(e);
      // 404 = no release published yet, not an internet error
      const noRelease = msg.includes("404") || msg.includes("not found") || msg.includes("No release");
      setUpdateStatus({
        state: "error",
        message: noRelease
          ? "No release published yet. Updates will appear here automatically when a new version ships."
          : "Could not reach the update server. Check your internet connection.",
      });
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.5)", backdropFilter: "blur(4px)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="w-full max-w-md rounded-2xl shadow-2xl overflow-hidden"
        style={{ background: "var(--sidebar)", border: "1px solid var(--border)" }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 py-4"
          style={{ borderBottom: "1px solid var(--border)" }}
        >
          <h2 className="font-semibold text-sm" style={{ color: "var(--text)" }}>Settings</h2>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-lg transition-colors"
            style={{ color: "var(--muted)" }}
            onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = "var(--surface)")}
            onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = "transparent")}
          >
            <X size={14} />
          </button>
        </div>

        {/* About section */}
        <div className="px-5 py-4" style={{ borderBottom: "1px solid var(--border)" }}>
          <p className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: "var(--muted)" }}>
            About
          </p>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium" style={{ color: "var(--text)" }}>Berries Code</p>
              <p className="text-xs mt-0.5" style={{ color: "var(--subtext)" }}>Version {appVersion}</p>
            </div>
            <span
              className="text-xs px-2 py-1 rounded-full"
              style={{ background: "var(--surface)", color: "var(--subtext)" }}
            >
              macOS
            </span>
          </div>
        </div>

        {/* Updates section */}
        <div className="px-5 py-4">
          <p className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: "var(--muted)" }}>
            Updates
          </p>

          {/* Status display */}
          {updateStatus.state === "idle" && (
            <p className="text-xs mb-3" style={{ color: "var(--subtext)" }}>
              Check if a newer version of Berries Code is available.
            </p>
          )}
          {updateStatus.state === "up-to-date" && (
            <div className="flex items-center gap-2 mb-3">
              <CheckCircle size={14} style={{ color: "var(--green)" }} />
              <p className="text-xs" style={{ color: "var(--green)" }}>You're on the latest version.</p>
            </div>
          )}
          {updateStatus.state === "available" && (
            <div
              className="flex items-center justify-between p-3 rounded-xl mb-3"
              style={{ background: "color-mix(in srgb, var(--green) 12%, transparent)", border: "1px solid color-mix(in srgb, var(--green) 30%, transparent)" }}
            >
              <div>
                <p className="text-xs font-semibold" style={{ color: "var(--green)" }}>
                  v{updateStatus.version} available
                </p>
                <p className="text-xs mt-0.5" style={{ color: "var(--subtext)" }}>Ready to download and install</p>
              </div>
              <button
                onClick={updateStatus.onInstall}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors"
                style={{ background: "var(--green)", color: "#000" }}
              >
                <Download size={11} />
                Install
              </button>
            </div>
          )}
          {updateStatus.state === "downloading" && (
            <div className="flex items-center gap-2 mb-3">
              <Loader size={14} className="animate-spin" style={{ color: "var(--accent)" }} />
              <p className="text-xs" style={{ color: "var(--accent)" }}>Downloading update…</p>
            </div>
          )}
          {updateStatus.state === "error" && (
            <div className="flex items-start gap-2 mb-3">
              <AlertCircle size={14} className="flex-shrink-0 mt-0.5" style={{ color: "var(--red)" }} />
              <p className="text-xs" style={{ color: "var(--red)" }}>
                {updateStatus.message}
              </p>
            </div>
          )}

          <button
            onClick={checkForUpdates}
            disabled={updateStatus.state === "checking" || updateStatus.state === "downloading"}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-medium transition-colors w-full justify-center"
            style={{
              background: "var(--surface)",
              color: updateStatus.state === "checking" ? "var(--muted)" : "var(--text)",
              border: "1px solid var(--border)",
              cursor: updateStatus.state === "checking" ? "not-allowed" : "pointer",
            }}
          >
            {updateStatus.state === "checking" ? (
              <Loader size={13} className="animate-spin" />
            ) : (
              <RefreshCw size={13} />
            )}
            {updateStatus.state === "checking" ? "Checking…" : "Check for Updates"}
          </button>
        </div>
      </div>
    </div>
  );
}
