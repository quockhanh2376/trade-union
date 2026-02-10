#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::{Deserialize, Serialize};
use std::{
    collections::HashSet,
    fs,
    path::{Path, PathBuf},
    process::Command,
};

const DEFAULT_DIST_GROUP: &str = "ASWVN_TradeUnion@aswhiteglobal.com";

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
struct GroupRunResult {
    action: String,
    processed: usize,
    stdout: String,
    stderr: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct GroupTypeResult {
    input_email: String,
    normalized_email: String,
    group_type: String,
    raw_type: String,
    display_name: String,
    primary_smtp_address: String,
    graph_allowed: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GroupTypeProbeOutput {
    group_type: String,
    raw_type: String,
    display_name: Option<String>,
    primary_smtp_address: Option<String>,
    graph_allowed: Option<bool>,
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

fn list_file_path(action: GroupAction) -> PathBuf {
    match action {
        GroupAction::Add => workspace_root().join("emails.txt"),
        GroupAction::Remove => workspace_root().join("removeemail.txt"),
    }
}

fn final_file_path() -> PathBuf {
    workspace_root().join("final.txt")
}

fn script_path() -> PathBuf {
    workspace_root()
        .join("src-tauri")
        .join("scripts")
        .join("manage_distribution_group.ps1")
}

fn detect_script_path() -> PathBuf {
    workspace_root()
        .join("src-tauri")
        .join("scripts")
        .join("detect_group_type.ps1")
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

fn default_group_email() -> String {
    normalize_email(DEFAULT_DIST_GROUP).unwrap_or_else(|| DEFAULT_DIST_GROUP.to_ascii_lowercase())
}

fn resolve_group_email(group_email: Option<String>) -> Result<String, String> {
    if let Some(value) = group_email {
        return normalize_email(&value).ok_or_else(|| "Invalid group email.".to_string());
    }

    if let Ok(value) = std::env::var("TRADE_UNION_GROUP") {
        if let Some(normalized) = normalize_email(&value) {
            return Ok(normalized);
        }
    }

    Ok(default_group_email())
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

fn parse_json_line(stdout: &str) -> Option<&str> {
    stdout
        .lines()
        .rev()
        .map(str::trim)
        .find(|line| line.starts_with('{') && line.ends_with('}'))
}

fn action_name(action: GroupAction) -> &'static str {
    match action {
        GroupAction::Add => "Add",
        GroupAction::Remove => "Remove",
    }
}

#[tauri::command]
fn load_seed_emails() -> Result<SeedEmails, String> {
    Ok(SeedEmails {
        add: read_email_file(&list_file_path(GroupAction::Add))?,
        remove: read_email_file(&list_file_path(GroupAction::Remove))?,
    })
}

#[tauri::command]
fn save_email_queues(add: Vec<String>, remove: Vec<String>) -> Result<(), String> {
    let mut add_set = sanitize_email_input(add).into_iter().collect::<HashSet<_>>();
    let mut remove_clean = sanitize_email_input(remove);
    remove_clean.sort();

    for email in &remove_clean {
        add_set.remove(email);
    }

    let mut add_clean = add_set.into_iter().collect::<Vec<_>>();
    add_clean.sort();

    write_email_file(&list_file_path(GroupAction::Add), &add_clean)?;
    write_email_file(&list_file_path(GroupAction::Remove), &remove_clean)?;
    Ok(())
}

#[tauri::command]
fn check_group_type(group_email: String) -> Result<GroupTypeResult, String> {
    let normalized = normalize_email(&group_email).ok_or_else(|| "Invalid group email.".to_string())?;

    let script = detect_script_path();
    if !script.exists() {
        return Err(format!("Missing PowerShell script: {}", script.display()));
    }

    let output = Command::new("powershell")
        .arg("-NoProfile")
        .arg("-ExecutionPolicy")
        .arg("Bypass")
        .arg("-File")
        .arg(script.as_os_str())
        .arg("-GroupEmail")
        .arg(&normalized)
        .output()
        .map_err(|err| format!("Failed to launch PowerShell: {err}"))?;

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();

    if !output.status.success() {
        return Err(build_command_error("Check Group Type failed.", &stdout, &stderr));
    }

    let json_line = parse_json_line(&stdout)
        .ok_or_else(|| format!("Cannot parse group type output.\n{stdout}"))?;

    let parsed: GroupTypeProbeOutput = serde_json::from_str(json_line)
        .map_err(|err| format!("Invalid group type payload: {err}\nRaw: {json_line}"))?;

    Ok(GroupTypeResult {
        input_email: group_email.trim().to_string(),
        normalized_email: normalized,
        group_type: parsed.group_type,
        raw_type: parsed.raw_type,
        display_name: parsed.display_name.unwrap_or_default(),
        primary_smtp_address: parsed.primary_smtp_address.unwrap_or_default(),
        graph_allowed: parsed.graph_allowed.unwrap_or(false),
    })
}

#[tauri::command]
fn run_group_action(
    action: GroupAction,
    emails: Vec<String>,
    group_email: Option<String>,
) -> Result<GroupRunResult, String> {
    let cleaned = sanitize_email_input(emails);
    if cleaned.is_empty() {
        return Err("No valid emails to process.".to_string());
    }

    let queue_file = list_file_path(action);
    write_email_file(&queue_file, &cleaned)?;

    let script = script_path();
    if !script.exists() {
        return Err(format!("Missing PowerShell script: {}", script.display()));
    }

    let action_name = action_name(action);
    let dist_group = resolve_group_email(group_email)?;

    let output = Command::new("powershell")
        .arg("-NoProfile")
        .arg("-ExecutionPolicy")
        .arg("Bypass")
        .arg("-File")
        .arg(script.as_os_str())
        .arg("-Action")
        .arg(action_name)
        .arg("-DistGroup")
        .arg(dist_group)
        .arg("-InputFile")
        .arg(queue_file.as_os_str())
        .arg("-OutputFile")
        .arg(final_file_path().as_os_str())
        .output()
        .map_err(|err| format!("Failed to launch PowerShell: {err}"))?;

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();

    if !output.status.success() {
        return Err(build_command_error(
            &format!("{action_name} action failed."),
            &stdout,
            &stderr,
        ));
    }

    Ok(GroupRunResult {
        action: action_name.to_ascii_lowercase(),
        processed: cleaned.len(),
        stdout,
        stderr,
    })
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            load_seed_emails,
            save_email_queues,
            check_group_type,
            run_group_action
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
