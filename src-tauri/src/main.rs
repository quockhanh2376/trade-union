#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::{Deserialize, Serialize};
use std::{
    collections::HashSet,
    fs,
    path::{Path, PathBuf},
    process::Command,
};
use tauri::{path::BaseDirectory, AppHandle, Manager};

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
enum GroupAction {
    Add,
    Remove,
}

#[derive(Serialize)]
struct SeedEmails {
    add: Vec<String>,
    remove: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct GroupRunResult {
    action: String,
    processed: usize,
    success_count: usize,
    failed_count: usize,
    details: Vec<ActionDetail>,
    stdout: String,
    stderr: String,
}

#[derive(Deserialize)]
struct ResultJson {
    success: usize,
    failed: usize,
    #[serde(default)]
    processed: usize,
    #[serde(default)]
    details: Vec<ActionDetail>,
}

#[derive(Serialize, Deserialize, Clone)]
struct ActionDetail {
    email: String,
    group: String,
    status: String,
    #[serde(default)]
    message: String,
}

fn workspace_root() -> PathBuf {
    if let Ok(path) = std::env::var("TRADE_UNION_ROOT") {
        let value = PathBuf::from(path);
        if value.exists() {
            return value;
        }
    }

    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    manifest_dir
        .parent()
        .map_or(manifest_dir.clone(), Path::to_path_buf)
}

fn app_data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let path = app
        .path()
        .app_data_dir()
        .map_err(|err| format!("Cannot resolve app data directory: {err}"))?;
    fs::create_dir_all(&path)
        .map_err(|err| format!("Cannot create app data directory {}: {err}", path.display()))?;
    Ok(path)
}

fn list_file_path(app: &AppHandle, action: GroupAction) -> Result<PathBuf, String> {
    let file_name = match action {
        GroupAction::Add => "emails.txt",
        GroupAction::Remove => "removeemail.txt",
    };
    Ok(app_data_dir(app)?.join(file_name))
}

fn final_file_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app_data_dir(app)?.join("final.txt"))
}

fn workspace_script_path() -> PathBuf {
    workspace_root()
        .join("src-tauri")
        .join("scripts")
        .join("manage_distribution_group.ps1")
}

fn script_path(app: &AppHandle) -> Result<PathBuf, String> {
    if let Ok(path) = std::env::var("TRADE_UNION_ROOT") {
        let candidate = PathBuf::from(path)
            .join("src-tauri")
            .join("scripts")
            .join("manage_distribution_group.ps1");
        if candidate.exists() {
            return Ok(candidate);
        }
    }

    let resource_path = app
        .path()
        .resolve("scripts/manage_distribution_group.ps1", BaseDirectory::Resource)
        .map_err(|err| format!("Cannot resolve bundled PowerShell script: {err}"))?;
    if resource_path.exists() {
        return Ok(resource_path);
    }

    let dev_path = workspace_script_path();
    if dev_path.exists() {
        return Ok(dev_path);
    }

    Ok(resource_path)
}

fn legacy_credential_file_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app_data_dir(app)?
        .join(".credentials")
        .join("admin_credential.json"))
}

fn normalize_email(email: &str) -> Option<String> {
    let trimmed = email.trim().to_ascii_lowercase();
    if trimmed.is_empty() || !trimmed.contains('@') {
        return None;
    }

    let mut parts = trimmed.split('@');
    let local = parts.next().unwrap_or_default();
    let domain = parts.next().unwrap_or_default();

    if local.is_empty() || domain.is_empty() || parts.next().is_some() || !domain.contains('.') {
        return None;
    }

    Some(trimmed)
}

fn sanitize_email_input(input: Vec<String>) -> Vec<String> {
    let mut seen = HashSet::new();
    let mut cleaned = Vec::new();

    for value in input {
        if let Some(email) = normalize_email(&value) {
            if seen.insert(email.clone()) {
                cleaned.push(email);
            }
        }
    }

    cleaned
}

fn sanitize_group_input(input: Vec<String>) -> Vec<String> {
    sanitize_email_input(input)
}

fn read_email_file(path: &Path) -> Result<Vec<String>, String> {
    if !path.exists() {
        return Ok(Vec::new());
    }

    let content =
        fs::read_to_string(path).map_err(|err| format!("Cannot read {}: {err}", path.display()))?;

    let lines = content
        .lines()
        .map(ToOwned::to_owned)
        .collect::<Vec<String>>();

    Ok(sanitize_email_input(lines))
}

fn write_email_file(path: &Path, emails: &[String]) -> Result<(), String> {
    let content = if emails.is_empty() {
        String::new()
    } else {
        format!("{}\n", emails.join("\n"))
    };

    fs::write(path, content).map_err(|err| format!("Cannot write {}: {err}", path.display()))
}

fn build_command_error(prefix: &str, stdout: &str, stderr: &str) -> String {
    let mut message = prefix.to_string();
    if !stderr.is_empty() {
        message = format!("{message}\n{stderr}");
    }
    if !stdout.is_empty() {
        message = format!("{message}\n{stdout}");
    }
    message
}

fn action_name(action: GroupAction) -> &'static str {
    match action {
        GroupAction::Add => "Add",
        GroupAction::Remove => "Remove",
    }
}

fn parse_result_json(stdout: &str) -> Option<(usize, usize, usize, Vec<ActionDetail>)> {
    for line in stdout.lines().rev() {
        let trimmed = line.trim();
        if let Some(json_str) = trimmed.strip_prefix("RESULT_JSON:") {
            if let Ok(parsed) = serde_json::from_str::<ResultJson>(json_str) {
                return Some((
                    parsed.success,
                    parsed.failed,
                    parsed.processed,
                    parsed.details,
                ));
            }
        }
    }
    None
}

fn clear_legacy_saved_admin_credential_file(app: &AppHandle) -> Result<(), String> {
    let path = legacy_credential_file_path(app)?;
    if path.exists() {
        fs::remove_file(&path).map_err(|err| {
            format!(
                "Cannot remove saved credential file {}: {err}",
                path.display()
            )
        })?;
    }
    Ok(())
}

#[tauri::command]
fn load_seed_emails(app: AppHandle) -> Result<SeedEmails, String> {
    Ok(SeedEmails {
        add: read_email_file(&list_file_path(&app, GroupAction::Add)?)?,
        remove: read_email_file(&list_file_path(&app, GroupAction::Remove)?)?,
    })
}

#[tauri::command]
fn save_email_queues(app: AppHandle, add: Vec<String>, remove: Vec<String>) -> Result<(), String> {
    let mut add_set = sanitize_email_input(add)
        .into_iter()
        .collect::<HashSet<_>>();
    let mut remove_clean = sanitize_email_input(remove);
    remove_clean.sort();

    for email in &remove_clean {
        add_set.remove(email);
    }

    let mut add_clean = add_set.into_iter().collect::<Vec<_>>();
    add_clean.sort();

    write_email_file(&list_file_path(&app, GroupAction::Add)?, &add_clean)?;
    write_email_file(&list_file_path(&app, GroupAction::Remove)?, &remove_clean)?;
    Ok(())
}

#[tauri::command]
async fn run_group_action(
    app: AppHandle,
    action: GroupAction,
    emails: Vec<String>,
    group_emails: Vec<String>,
    admin_upn: Option<String>,
    force_reconnect: Option<bool>,
) -> Result<GroupRunResult, String> {
    let cleaned_admin_upn = match admin_upn {
        Some(value) => Some(
            normalize_email(&value).ok_or_else(|| "Invalid admin account email.".to_string())?,
        ),
        None => None,
    };

    let queue_file = list_file_path(&app, action)?;
    let output_file = final_file_path(&app)?;
    let script = script_path(&app)?;

    tauri::async_runtime::spawn_blocking(move || {
        let cleaned = sanitize_email_input(emails);
        if cleaned.is_empty() {
            return Err("No valid emails to process.".to_string());
        }

        let groups = sanitize_group_input(group_emails);
        if groups.is_empty() {
            return Err("No valid distribution groups to process.".to_string());
        }

        write_email_file(&queue_file, &cleaned)?;

        if !script.exists() {
            return Err(format!("Missing PowerShell script: {}", script.display()));
        }

        let act = action_name(action);
        let group_arg = groups.join(", ");

        let mut cmd = Command::new("powershell");
        cmd.arg("-NoProfile")
            .arg("-ExecutionPolicy")
            .arg("Bypass")
            .arg("-File")
            .arg(script.as_os_str())
            .arg("-Action")
            .arg(act)
            .arg("-DistGroups")
            .arg(&group_arg)
            .arg("-InputFile")
            .arg(queue_file.as_os_str())
            .arg("-OutputFile")
            .arg(output_file.as_os_str());

        if let Some(ref upn) = cleaned_admin_upn {
            cmd.arg("-AdminUpn").arg(upn);
        }

        if force_reconnect.unwrap_or(false) {
            cmd.arg("-ForceReconnect");
        }

        let output = cmd
            .output()
            .map_err(|err| format!("Failed to launch PowerShell: {err}"))?;

        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();

        if !output.status.success() {
            return Err(build_command_error(
                &format!("{act} action failed."),
                &stdout,
                &stderr,
            ));
        }

        let default_processed = cleaned.len() * groups.len();
        let (success_count, failed_count, processed, details) = parse_result_json(&stdout)
            .unwrap_or((default_processed, 0, default_processed, Vec::new()));

        Ok(GroupRunResult {
            action: act.to_ascii_lowercase(),
            processed: if processed == 0 {
                default_processed
            } else {
                processed
            },
            success_count,
            failed_count,
            details,
            stdout,
            stderr,
        })
    })
    .await
    .map_err(|err| format!("Background task failed: {err}"))?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exchange_script_uses_modern_auth_without_password_credentials() {
        let script =
            fs::read_to_string(workspace_script_path()).expect("read Exchange action script");

        assert!(
            !script.contains("Connect-ExchangeOnline -Credential"),
            "Exchange Online auth must not use password credential auth because it breaks MFA accounts"
        );
        assert!(
            script.contains("Connect-ExchangeOnline -UserPrincipalName $AdminAccount"),
            "admin UPN should be passed into the modern Exchange Online sign-in prompt"
        );
    }
}

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let _ = clear_legacy_saved_admin_credential_file(app.handle());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            load_seed_emails,
            save_email_queues,
            run_group_action
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
