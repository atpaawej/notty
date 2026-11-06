use serde::Serialize;
use std::path::{Path, PathBuf};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct UpdaterInfo {
    version: String,
    install_dir: String,
    writable: bool,
    user_space: bool,
}

fn home_dir() -> Option<PathBuf> {
    std::env::var_os("HOME")
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
}

fn data_home() -> Option<PathBuf> {
    std::env::var_os("XDG_DATA_HOME")
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .or_else(|| home_dir().map(|home| home.join(".local").join("share")))
}

/// Probe by creating a real file: Unix mode bits alone do not account for
/// ACLs, immutable mounts or a read-only filesystem.
fn is_writable(directory: &Path) -> bool {
    let probe = directory.join(format!(".notty-write-test-{}", std::process::id()));
    match std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&probe)
    {
        Ok(_) => {
            let _ = std::fs::remove_file(&probe);
            true
        }
        Err(_) => false,
    }
}

#[tauri::command]
fn updater_info() -> Result<UpdaterInfo, String> {
    let executable = std::env::current_exe().map_err(|cause| cause.to_string())?;
    let install_dir = executable
        .parent()
        .ok_or_else(|| "The executable has no parent directory".to_string())?
        .to_path_buf();
    let user_space = data_home()
        .map(|data| data.join("notty") == install_dir)
        .unwrap_or(false);

    Ok(UpdaterInfo {
        version: env!("CARGO_PKG_VERSION").to_string(),
        install_dir: install_dir.to_string_lossy().into_owned(),
        writable: is_writable(&install_dir),
        user_space,
    })
}

fn copy_tree(source: &Path, destination: &Path) -> Result<usize, String> {
    let mut copied = 0;
    let entries = std::fs::read_dir(source)
        .map_err(|cause| format!("Could not read {}: {cause}", source.display()))?;

    for entry in entries {
        let entry = entry.map_err(|cause| cause.to_string())?;
        let path = entry.path();
        let kind = entry.file_type().map_err(|cause| cause.to_string())?;
        let relative = path
            .strip_prefix(source)
            .map_err(|cause| cause.to_string())?;
        let target = destination.join(relative);

        if kind.is_dir() {
            std::fs::create_dir_all(&target).map_err(|cause| cause.to_string())?;
            copied += copy_tree(&path, &target)?;
            continue;
        }

        if !kind.is_file() {
            // The updater never stages links or device nodes.
            continue;
        }

        if let Some(parent) = target.parent() {
            std::fs::create_dir_all(parent).map_err(|cause| cause.to_string())?;
        }

        let file_name = target
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("notty-file");
        let temporary = target.with_file_name(format!(".{file_name}.notty-new"));

        std::fs::copy(&path, &temporary).map_err(|cause| {
            format!(
                "Could not stage {} into {}: {cause}",
                path.display(),
                temporary.display()
            )
        })?;

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let executable = matches!(file_name, "notty" | "notty-desktop");
            let mode = if executable { 0o755 } else { 0o644 };
            std::fs::set_permissions(&temporary, std::fs::Permissions::from_mode(mode))
                .map_err(|cause| cause.to_string())?;
        }

        // A same-directory rename replaces the old file atomically. Linux
        // permits replacing a running executable this way.
        std::fs::rename(&temporary, &target).map_err(|cause| cause.to_string())?;
        copied += 1;
    }

    Ok(copied)
}

#[tauri::command]
fn updater_apply_stage(staging: String, install_dir: String) -> Result<usize, String> {
    let staging_path = PathBuf::from(staging);
    if !staging_path.is_dir() {
        return Err("The staged update directory is missing".to_string());
    }

    let install_path = PathBuf::from(install_dir);
    if install_path.as_os_str().is_empty() {
        return Err("The installation directory is unknown".to_string());
    }
    std::fs::create_dir_all(&install_path).map_err(|cause| cause.to_string())?;

    let copied = copy_tree(&staging_path, &install_path)?;
    if copied == 0 {
        return Err("The update archive contained no files".to_string());
    }

    let _ = std::fs::remove_dir_all(&staging_path);
    Ok(copied)
}

#[tauri::command]
fn updater_restart(app: tauri::AppHandle) {
    app.restart();
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .invoke_handler(tauri::generate_handler![
            updater_info,
            updater_apply_stage,
            updater_restart
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
