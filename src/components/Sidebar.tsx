import { useState, useCallback, useRef, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Folder, FolderOpen, File, ChevronRight, ChevronDown,
  FolderPlus, MessageSquare, Plus,
} from "lucide-react";

interface FileEntry {
  name: string;
  path: string;
  is_dir: boolean;
}

interface TreeNode extends FileEntry {
  children?: TreeNode[];
  expanded?: boolean;
}

interface SessionInfo {
  id: string;
  title: string;
  modified: number; // unix seconds
}

interface Props {
  width: number;
  onWidthChange: (w: number) => void;
  workdir: string;
  onWorkdirChange: (path: string) => void;
  sessionId: string | null;
  onSessionSelect: (id: string | null) => void;
  sessionRefreshKey: number;
}

// Stable color per project name
const PROJECT_COLORS = [
  "#cba6f7", "#89b4fa", "#a6e3a1", "#f9e2af",
  "#f38ba8", "#94e2d5", "#fab387", "#b4befe",
];
function projectColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffff;
  return PROJECT_COLORS[h % PROJECT_COLORS.length];
}

function relativeTime(unixSecs: number): string {
  const diff = Math.floor(Date.now() / 1000) - unixSecs;
  if (diff < 60) return "now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  if (diff < 86400 * 30) return `${Math.floor(diff / 86400)}d`;
  return `${Math.floor(diff / 86400 / 30)}mo`;
}

// ── Project card ─────────────────────────────────────────────────────────────
function ProjectCard({ name, path, active, onClick }: {
  name: string; path: string; active: boolean; onClick: () => void;
}) {
  const color = projectColor(name);
  return (
    <button
      onClick={onClick}
      title={path}
      style={{
        width: "100%", display: "flex", alignItems: "center", gap: "10px",
        padding: "8px 10px", borderRadius: "8px", border: "none",
        background: active
          ? `color-mix(in srgb, ${color} 15%, var(--surface))`
          : "transparent",
        cursor: "pointer", textAlign: "left",
        outline: active ? `1px solid color-mix(in srgb, ${color} 40%, transparent)` : "none",
      }}
      onMouseEnter={(e) => { if (!active) (e.currentTarget as HTMLElement).style.background = "var(--surface)"; }}
      onMouseLeave={(e) => { if (!active) (e.currentTarget as HTMLElement).style.background = "transparent"; }}
    >
      <span style={{
        width: "28px", height: "28px", borderRadius: "7px",
        background: `color-mix(in srgb, ${color} 25%, var(--bg))`,
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: "13px", fontWeight: 700, color, flexShrink: 0,
        border: `1px solid color-mix(in srgb, ${color} 30%, transparent)`,
      }}>
        {name.charAt(0).toUpperCase()}
      </span>
      <span style={{
        fontSize: "12px", fontWeight: active ? 600 : 400,
        color: active ? color : "var(--text)",
        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
      }}>
        {name}
      </span>
    </button>
  );
}

// ── Session item ──────────────────────────────────────────────────────────────
function SessionItem({ session, active, onClick }: {
  session: SessionInfo; active: boolean; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      title={session.title}
      style={{
        width: "100%", display: "flex", alignItems: "center", gap: "7px",
        padding: "5px 8px", borderRadius: "6px", border: "none",
        background: active ? "var(--surface)" : "transparent",
        cursor: "pointer", textAlign: "left",
        outline: active ? "1px solid var(--border)" : "none",
      }}
      onMouseEnter={(e) => { if (!active) (e.currentTarget as HTMLElement).style.background = "color-mix(in srgb, var(--surface) 60%, transparent)"; }}
      onMouseLeave={(e) => { if (!active) (e.currentTarget as HTMLElement).style.background = "transparent"; }}
    >
      <MessageSquare
        size={11}
        style={{ color: active ? "var(--accent)" : "var(--muted)", flexShrink: 0 }}
      />
      <span style={{
        flex: 1, fontSize: "11px",
        color: active ? "var(--text)" : "var(--subtext)",
        fontWeight: active ? 500 : 400,
        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
      }}>
        {session.title}
      </span>
      <span style={{ fontSize: "10px", color: "var(--muted)", flexShrink: 0 }}>
        {relativeTime(session.modified)}
      </span>
    </button>
  );
}

// ── File tree node ────────────────────────────────────────────────────────────
function FileNode({ node, depth, onToggle, onSelect }: {
  node: TreeNode; depth: number;
  onToggle: (path: string) => void; onSelect: (path: string) => void;
}) {
  return (
    <>
      <div
        className="file-tree-item"
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
        onClick={() => node.is_dir ? onToggle(node.path) : onSelect(node.path)}
        title={node.path}
      >
        {node.is_dir ? (
          <>
            <span style={{ color: "var(--muted)", flexShrink: 0 }}>
              {node.expanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
            </span>
            <span style={{ color: "var(--accent2)", flexShrink: 0 }}>
              {node.expanded ? <FolderOpen size={13} /> : <Folder size={13} />}
            </span>
          </>
        ) : (
          <>
            <span style={{ width: 11, flexShrink: 0 }} />
            <span style={{ color: "var(--muted)", flexShrink: 0 }}><File size={13} /></span>
          </>
        )}
        <span className="truncate" style={{ color: node.is_dir ? "var(--text)" : "var(--subtext)" }}>
          {node.name}
        </span>
      </div>
      {node.is_dir && node.expanded && node.children?.map((child) => (
        <FileNode key={child.path} node={child} depth={depth + 1} onToggle={onToggle} onSelect={onSelect} />
      ))}
    </>
  );
}

// ── Sidebar ───────────────────────────────────────────────────────────────────
export function Sidebar({
  width, onWidthChange, workdir, onWorkdirChange,
  sessionId, onSessionSelect, sessionRefreshKey,
}: Props) {
  const [projects, setProjects] = useState<FileEntry[]>([]);
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [projectsOpen, setProjectsOpen] = useState(true);
  const resizing = useRef(false);
  const startX = useRef(0);
  const startW = useRef(0);

  const loadDir = useCallback(async (path: string): Promise<TreeNode[]> => {
    try {
      const entries = await invoke<FileEntry[]>("read_dir", { path });
      return entries.map((e) => ({ ...e, expanded: false, children: [] }));
    } catch { return []; }
  }, []);

  // Load projects from ~/AI files on mount
  useEffect(() => {
    const load = async () => {
      const home = await invoke<string>("get_home_dir");
      try {
        const entries = await invoke<FileEntry[]>("read_dir", { path: `${home}/AI files` });
        setProjects(entries.filter((e) => e.is_dir));
      } catch { /* AI files dir doesn't exist */ }
    };
    load();
  }, []);

  // Load sessions when workdir or refresh key changes
  useEffect(() => {
    if (!workdir) {
      setSessions([]);
      return;
    }
    invoke<SessionInfo[]>("list_sessions", { project_path: workdir })
      .then(setSessions)
      .catch(() => setSessions([]));
  }, [workdir, sessionRefreshKey]);

  // Load file tree when workdir changes
  useEffect(() => {
    if (!workdir) return;
    loadDir(workdir).then(setTree);
  }, [workdir, loadDir]);

  const handleToggle = async (path: string) => {
    const toggle = async (nodes: TreeNode[]): Promise<TreeNode[]> =>
      Promise.all(nodes.map(async (n) => {
        if (n.path === path) {
          const expanded = !n.expanded;
          return { ...n, expanded, children: expanded ? await loadDir(path) : n.children };
        }
        if (n.children) return { ...n, children: await toggle(n.children) };
        return n;
      }));
    setTree(await toggle(tree));
  };

  const handleSelect = (path: string) => {
    window.dispatchEvent(new CustomEvent("insert-path", { detail: path }));
  };

  // Resize handle
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!resizing.current) return;
      onWidthChange(Math.max(180, Math.min(420, startW.current + e.clientX - startX.current)));
    };
    const onUp = () => { resizing.current = false; };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, [onWidthChange]);

  const activeProjectName = workdir ? workdir.split("/").pop() ?? "" : "";

  return (
    <div
      className="flex flex-col flex-shrink-0 overflow-hidden relative"
      style={{ width, background: "var(--sidebar)" }}
    >
      {/* ── Projects ── */}
      <div style={{ flexShrink: 0 }}>
        <button
          onClick={() => setProjectsOpen((v) => !v)}
          style={{
            width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between",
            padding: "8px 12px", border: "none", background: "transparent",
            borderBottom: `1px solid var(--border)`, cursor: "pointer",
          }}
        >
          <span style={{ fontSize: "10px", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--muted)" }}>
            Projects
          </span>
          <span style={{ color: "var(--muted)", transform: projectsOpen ? "rotate(90deg)" : "none", transition: "transform 0.15s" }}>
            <ChevronRight size={12} />
          </span>
        </button>

        {projectsOpen && (
          <div style={{
            maxHeight: "220px", overflowY: "auto",
            padding: "6px 8px",
            borderBottom: `1px solid var(--border)`,
          }}>
            {projects.length === 0 ? (
              <p style={{ fontSize: "11px", color: "var(--muted)", padding: "8px 4px", textAlign: "center" }}>
                No projects found in ~/AI files
              </p>
            ) : (
              projects.map((p) => (
                <ProjectCard
                  key={p.path}
                  name={p.name}
                  path={p.path}
                  active={workdir === p.path}
                  onClick={() => onWorkdirChange(p.path)}
                />
              ))
            )}
          </div>
        )}
      </div>

      {/* ── Sessions ── */}
      {workdir && (
        <div style={{ flexShrink: 0, borderBottom: `1px solid var(--border)` }}>
          <div style={{
            padding: "8px 12px",
            display: "flex", alignItems: "center", justifyContent: "space-between",
          }}>
            <span style={{ fontSize: "10px", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--muted)" }}>
              {activeProjectName}
            </span>
            <button
              onClick={() => onSessionSelect(null)}
              title="New conversation"
              style={{
                display: "flex", alignItems: "center", gap: "3px",
                padding: "2px 6px", borderRadius: "4px", border: "1px solid var(--border)",
                background: "transparent", color: "var(--muted)", cursor: "pointer",
                fontSize: "10px", fontWeight: 600,
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLElement).style.background = "var(--surface)";
                (e.currentTarget as HTMLElement).style.color = "var(--text)";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLElement).style.background = "transparent";
                (e.currentTarget as HTMLElement).style.color = "var(--muted)";
              }}
            >
              <Plus size={10} />
              New
            </button>
          </div>

          <div style={{ maxHeight: "200px", overflowY: "auto", padding: "0 8px 6px" }}>
            {sessions.length === 0 ? (
              <p style={{ fontSize: "11px", color: "var(--muted)", padding: "2px 4px 8px", textAlign: "center" }}>
                No sessions yet
              </p>
            ) : (
              sessions.map((s) => (
                <SessionItem
                  key={s.id}
                  session={s}
                  active={sessionId === s.id}
                  onClick={() => onSessionSelect(s.id)}
                />
              ))
            )}
          </div>
        </div>
      )}

      {/* ── File explorer ── */}
      <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
        <div style={{
          padding: "8px 12px", borderBottom: "1px solid var(--border)",
          display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0,
        }}>
          <span style={{ fontSize: "10px", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--muted)" }}>
            Explorer
          </span>
          {!workdir && (
            <button
              onClick={async () => {
                const { open } = await import("@tauri-apps/plugin-dialog");
                const selected = await open({ directory: true, multiple: false });
                if (selected && typeof selected === "string") {
                  onWorkdirChange(selected);
                }
              }}
              title="Open folder"
              style={{ background: "none", border: "none", cursor: "pointer", color: "var(--muted)", display: "flex" }}
              onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.color = "var(--text)")}
              onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.color = "var(--muted)")}
            >
              <FolderPlus size={14} />
            </button>
          )}
        </div>

        <div style={{ flex: 1, overflowY: "auto", paddingTop: "4px" }}>
          {!workdir && (
            <div style={{ padding: "20px 16px", textAlign: "center" }}>
              <Folder size={24} style={{ color: "var(--muted)", margin: "0 auto 8px" }} />
              <p style={{ fontSize: "11px", color: "var(--muted)", lineHeight: 1.5 }}>
                Select a project above
              </p>
            </div>
          )}
          {tree.map((node) => (
            <FileNode key={node.path} node={node} depth={0} onToggle={handleToggle} onSelect={handleSelect} />
          ))}
        </div>
      </div>

      {/* Resize handle */}
      <div
        style={{ position: "absolute", top: 0, right: 0, height: "100%", width: "4px", cursor: "col-resize" }}
        onMouseDown={(e) => {
          resizing.current = true;
          startX.current = e.clientX;
          startW.current = width;
          e.preventDefault();
        }}
        onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = "var(--accent)")}
        onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = "transparent")}
      />
    </div>
  );
}
