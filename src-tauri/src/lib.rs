use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use serde::{Deserialize, Serialize};
use std::io::{BufRead, Read, Write};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, State};

// ── State ─────────────────────────────────────────────────────────────────────

struct PtyInner {
    writer: Box<dyn Write + Send>,
    master: Box<dyn portable_pty::MasterPty + Send>,
}

#[derive(Default)]
struct PtyState(Mutex<Option<PtyInner>>);

// ── PTY Commands ──────────────────────────────────────────────────────────────

#[tauri::command]
fn pty_create(
    app: AppHandle,
    state: State<'_, PtyState>,
    rows: u16,
    cols: u16,
    workdir: Option<String>,
    session_id: Option<String>,
) -> Result<(), String> {
    if let Ok(mut guard) = state.0.lock() {
        *guard = None;
    }

    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
        .map_err(|e| e.to_string())?;

    let claude_path = find_claude();
    let mut cmd = CommandBuilder::new(&claude_path);

    if let Some(ref dir) = workdir {
        cmd.cwd(dir);
    }

    if let Some(ref sid) = session_id {
        cmd.arg("--resume");
        cmd.arg(sid);
    }

    let home = std::env::var("HOME").unwrap_or_default();
    let current_path = std::env::var("PATH").unwrap_or_default();
    let augmented_path = format!(
        "{current_path}:/usr/local/bin:/opt/homebrew/bin:{home}/.npm-global/bin:{home}/.nvm/current/bin"
    );
    cmd.env("PATH", augmented_path);
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");
    if !home.is_empty() {
        cmd.env("HOME", &home);
    }

    let _child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("Failed to spawn claude: {e}\nPath tried: {claude_path}"))?;

    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;
    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;

    {
        let mut guard = state.0.lock().unwrap();
        *guard = Some(PtyInner { writer, master: pair.master });
    }

    let app_handle = app.clone();
    std::thread::spawn(move || {
        let mut buf = [0u8; 4096];
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    let data: Vec<u8> = buf[..n].to_vec();
                    app_handle.emit("pty-data", data).ok();
                }
            }
        }
        app_handle.emit("pty-exit", ()).ok();
    });

    Ok(())
}

#[tauri::command]
fn pty_write(state: State<'_, PtyState>, data: Vec<u8>) -> Result<(), String> {
    let mut guard = state.0.lock().unwrap();
    if let Some(inner) = guard.as_mut() {
        inner.writer.write_all(&data).map_err(|e| e.to_string())?;
        inner.writer.flush().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn pty_resize(state: State<'_, PtyState>, rows: u16, cols: u16) -> Result<(), String> {
    let guard = state.0.lock().unwrap();
    if let Some(inner) = guard.as_ref() {
        inner
            .master
            .resize(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn pty_kill(state: State<'_, PtyState>) -> Result<(), String> {
    let mut guard = state.0.lock().unwrap();
    *guard = None;
    Ok(())
}

// ── File system commands ──────────────────────────────────────────────────────

#[derive(Serialize, Deserialize)]
struct FileEntry {
    name: String,
    path: String,
    is_dir: bool,
}

#[tauri::command]
fn read_dir(path: String) -> Result<Vec<FileEntry>, String> {
    let entries = std::fs::read_dir(&path).map_err(|e| e.to_string())?;

    let mut result: Vec<FileEntry> = entries
        .filter_map(|entry| {
            let entry = entry.ok()?;
            let metadata = entry.metadata().ok()?;
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with('.') {
                return None;
            }
            Some(FileEntry {
                name,
                path: entry.path().to_string_lossy().to_string(),
                is_dir: metadata.is_dir(),
            })
        })
        .collect();

    result.sort_by(|a, b| match (a.is_dir, b.is_dir) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    });

    Ok(result)
}

#[tauri::command]
fn get_home_dir() -> String {
    std::env::var("HOME").unwrap_or_else(|_| "/".to_string())
}

// ── Session commands ──────────────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Clone)]
struct SessionInfo {
    id: String,
    title: String,
    modified: u64,
}

// Claude Code sanitizes paths by replacing '/' and ' ' with '-'
fn sanitize_path_for_claude(path: &str) -> String {
    path.chars()
        .map(|c| if c == '/' || c == ' ' { '-' } else { c })
        .collect()
}

fn truncate_chars(s: &str, max: usize) -> String {
    let mut chars = s.chars();
    let head: String = chars.by_ref().take(max).collect();
    if chars.next().is_some() {
        format!("{head}…")
    } else {
        head
    }
}

fn extract_session_title(path: &std::path::Path) -> String {
    let Ok(file) = std::fs::File::open(path) else {
        return "New conversation".to_string();
    };

    let reader = std::io::BufReader::new(file);

    for line in reader.lines().take(120) {
        let Ok(line) = line else { continue };
        if line.trim().is_empty() {
            continue;
        }

        let Ok(val) = serde_json::from_str::<serde_json::Value>(&line) else {
            continue;
        };

        if val.get("type").and_then(|t| t.as_str()) != Some("user") {
            continue;
        }

        // Skip tool result messages — they're not human-initiated
        if let Some(origin) = val.get("origin") {
            if origin.get("kind").and_then(|k| k.as_str()) == Some("tool") {
                continue;
            }
        }

        let text = match val.pointer("/message/content") {
            Some(serde_json::Value::String(s)) => s.clone(),
            Some(serde_json::Value::Array(arr)) => arr
                .iter()
                .find(|item| item.get("type").and_then(|t| t.as_str()) == Some("text"))
                .and_then(|item| item.get("text").and_then(|t| t.as_str()))
                .unwrap_or("")
                .to_string(),
            _ => continue,
        };

        let title = text.trim().lines().next().unwrap_or("").trim().to_string();
        if !title.is_empty() {
            return truncate_chars(&title, 55);
        }
    }

    "New conversation".to_string()
}

#[tauri::command]
fn list_sessions(project_path: String) -> Vec<SessionInfo> {
    let home = std::env::var("HOME").unwrap_or_default();
    let sanitized = sanitize_path_for_claude(&project_path);
    let sessions_dir = format!("{home}/.claude/projects/{sanitized}");

    let mut sessions = Vec::new();

    let Ok(entries) = std::fs::read_dir(&sessions_dir) else {
        return sessions;
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("jsonl") {
            continue;
        }

        let id = match path.file_stem().and_then(|s| s.to_str()) {
            Some(s) if !s.is_empty() => s.to_string(),
            _ => continue,
        };

        let modified = entry
            .metadata()
            .and_then(|m| m.modified())
            .map(|t| t.duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_secs())
            .unwrap_or(0);

        let title = extract_session_title(&path);
        sessions.push(SessionInfo { id, title, modified });
    }

    sessions.sort_by(|a, b| b.modified.cmp(&a.modified));
    sessions
}

// ── Helpers ───────────────────────────────────────────────────────────────────

fn find_claude() -> String {
    let home = std::env::var("HOME").unwrap_or_default();
    let candidates = vec![
        std::env::var("PATH")
            .unwrap_or_default()
            .split(':')
            .map(|dir| format!("{dir}/claude"))
            .find(|p| std::path::Path::new(p).exists()),
        Some(format!("{home}/.npm-global/bin/claude")),
        Some("/usr/local/bin/claude".to_string()),
        Some("/opt/homebrew/bin/claude".to_string()),
        Some(format!("{home}/.nvm/current/bin/claude")),
    ];

    for candidate in candidates.into_iter().flatten() {
        if std::path::Path::new(&candidate).exists() {
            return candidate;
        }
    }

    "claude".to_string()
}

// ── Entry point ───────────────────────────────────────────────────────────────

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(PtyState::default())
        .invoke_handler(tauri::generate_handler![
            pty_create,
            pty_write,
            pty_resize,
            pty_kill,
            read_dir,
            get_home_dir,
            list_sessions,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Berries Code");
}
