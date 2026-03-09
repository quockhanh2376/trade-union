#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::{Deserialize, Serialize};
use std::{
    collections::HashSet,
    fs,
    path::{Path, PathBuf},
    process::Command,
    time::{SystemTime, UNIX_EPOCH},
};

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

#[derive(Serialize, Deserialize)]
struct SavedAdminCredential {
    upn: String,
    encrypted_password: String,
    #[serde(default)]
    saved_at_epoch_ms: u64,
}

const CREDENTIAL_TTL_MS: u64 = 10 * 60 * 1000;

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

fn credential_file_path() -> PathBuf {
    workspace_root()
        .join(".credentials")
        .join("admin_credential.json")
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

fn current_epoch_ms() -> u64 {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    millis.try_into().unwrap_or(u64::MAX)
}

fn parse_result_json(stdout: &str) -> Option<(usize, usize, usize, Vec<ActionDetail>)> {
    for line in stdout.lines().rev() {
        let trimmed = line.trim();
        if let Some(json_str) = trimmed.strip_prefix("RESULT_JSON:") {
            if let Ok(parsed) = serde_json::from_str::<ResultJson>(json_str) {
                return Some((parsed.success, parsed.failed, parsed.processed, parsed.details));
            }
        }
    }
    None
}

fn run_powershell_inline(script: &str, envs: &[(&str, &str)]) -> Result<String, String> {
    let mut cmd = Command::new("powershell");
    cmd.arg("-NoProfile")
        .arg("-NonInteractive")
        .arg("-ExecutionPolicy")
        .arg("Bypass")
        .arg("-Command")
        .arg(script);

    for (key, value) in envs {
        cmd.env(key, value);
    }

    let output = cmd
        .output()
        .map_err(|err| format!("Failed to launch PowerShell helper: {err}"))?;
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();

    if !output.status.success() {
        return Err(build_command_error(
            "PowerShell helper command failed.",
            &stdout,
            &stderr,
        ));
    }

    Ok(stdout)
}

fn protect_password(plain: &str) -> Result<String, String> {
    if plain.trim().is_empty() {
        return Err("Cannot encrypt an empty password.".to_string());
    }

    let script = r#"
$ErrorActionPreference = "Stop"
$secure = ConvertTo-SecureString -String $env:TRADE_UNION_ADMIN_PASSWORD_PLAIN -AsPlainText -Force
$encrypted = ConvertFrom-SecureString -SecureString $secure
Write-Output $encrypted
"#;

    let stdout = run_powershell_inline(script, &[("TRADE_UNION_ADMIN_PASSWORD_PLAIN", plain)])?;
    let encrypted = stdout
        .lines()
        .rev()
        .find(|line| !line.trim().is_empty())
        .map(str::trim)
        .unwrap_or_default()
        .to_string();

    if encrypted.is_empty() {
        return Err("Failed to encrypt admin password.".to_string());
    }

    Ok(encrypted)
}

fn unprotect_password(encrypted: &str) -> Result<String, String> {
    let script = r#"
$ErrorActionPreference = "Stop"
$secure = ConvertTo-SecureString -String $env:TRADE_UNION_ADMIN_PASSWORD_ENCRYPTED
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try {
  $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
  Write-Output $plain
}
finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
}
"#;

    let stdout = run_powershell_inline(
        script,
        &[("TRADE_UNION_ADMIN_PASSWORD_ENCRYPTED", encrypted)],
    )?;

    Ok(stdout.trim().to_string())
}

fn load_saved_admin_credential() -> Result<Option<SavedAdminCredential>, String> {
    let path = credential_file_path();
    if !path.exists() {
        return Ok(None);
    }

    let raw = fs::read_to_string(&path)
        .map_err(|err| format!("Cannot read saved credential file {}: {err}", path.display()))?;
    let parsed = serde_json::from_str::<SavedAdminCredential>(&raw)
        .map_err(|err| format!("Invalid saved credential data {}: {err}", path.display()))?;

    let now = current_epoch_ms();
    let age = now.saturating_sub(parsed.saved_at_epoch_ms);
    if parsed.saved_at_epoch_ms == 0 || age >= CREDENTIAL_TTL_MS {
        let _ = clear_saved_admin_credential_file();
        return Ok(None);
    }

    Ok(Some(parsed))
}

fn save_admin_credential(upn: &str, plain_password: &str) -> Result<(), String> {
    let path = credential_file_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|err| format!("Cannot create credential folder {}: {err}", parent.display()))?;
    }

    let encrypted_password = protect_password(plain_password)?;
    let payload = SavedAdminCredential {
        upn: upn.to_string(),
        encrypted_password,
        saved_at_epoch_ms: current_epoch_ms(),
    };
    let json = serde_json::to_string(&payload)
        .map_err(|err| format!("Cannot serialize saved credential: {err}"))?;
    fs::write(&path, json)
        .map_err(|err| format!("Cannot write saved credential file {}: {err}", path.display()))
}

fn clear_saved_admin_credential_file() -> Result<(), String> {
    let path = credential_file_path();
    if path.exists() {
        fs::remove_file(&path)
            .map_err(|err| format!("Cannot remove saved credential file {}: {err}", path.display()))?;
    }
    Ok(())
}

fn resolve_saved_admin_password(admin_upn: Option<&str>) -> Result<Option<String>, String> {
    let Some(target_upn) = admin_upn else {
        return Ok(None);
    };

    let Some(saved) = load_saved_admin_credential()? else {
        return Ok(None);
    };

    if saved.upn != target_upn {
        return Ok(None);
    }

    let password = unprotect_password(&saved.encrypted_password)?;
    if password.is_empty() {
        return Ok(None);
    }

    Ok(Some(password))
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
async fn run_group_action(
    action: GroupAction,
    emails: Vec<String>,
    group_emails: Vec<String>,
    admin_upn: Option<String>,
    admin_password: Option<String>,
    force_reconnect: Option<bool>,
) -> Result<GroupRunResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let cleaned = sanitize_email_input(emails);
        if cleaned.is_empty() {
            return Err("No valid emails to process.".to_string());
        }

        let groups = sanitize_group_input(group_emails);
        if groups.is_empty() {
            return Err("No valid distribution groups to process.".to_string());
        }

        let cleaned_admin_upn = match admin_upn {
            Some(value) => Some(
                normalize_email(&value).ok_or_else(|| "Invalid admin account email.".to_string())?,
            ),
            None => None,
        };

        let supplied_password = admin_password.unwrap_or_default().trim().to_string();
        let resolved_password = if supplied_password.is_empty() {
            resolve_saved_admin_password(cleaned_admin_upn.as_deref())?
        } else {
            let upn = cleaned_admin_upn.clone().ok_or_else(|| {
                "Enter a valid admin account before saving password.".to_string()
            })?;
            save_admin_credential(&upn, &supplied_password)?;
            Some(supplied_password)
        };

        let queue_file = list_file_path(action);
        write_email_file(&queue_file, &cleaned)?;

        let script = script_path();
        if !script.exists() {
            return Err(format!("Missing PowerShell script: {}", script.display()));
        }

        let act = action_name(action);
        let group_arg = groups.join(";");

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
            .arg(final_file_path().as_os_str());

        if let Some(ref upn) = cleaned_admin_upn {
            cmd.arg("-AdminUpn").arg(upn);
        }

        if let Some(ref password) = resolved_password {
            cmd.env("TRADE_UNION_ADMIN_PASSWORD", password);
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
        let (success_count, failed_count, processed, details) =
            parse_result_json(&stdout).unwrap_or((default_processed, 0, default_processed, Vec::new()));

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

#[tauri::command]
fn has_saved_admin_credential(admin_upn: Option<String>) -> Result<bool, String> {
    let Some(cleaned_upn) = admin_upn.and_then(|value| normalize_email(&value)) else {
        return Ok(false);
    };

    let Some(saved) = load_saved_admin_credential()? else {
        return Ok(false);
    };

    Ok(saved.upn == cleaned_upn)
}

#[tauri::command]
fn clear_saved_admin_credential() -> Result<(), String> {
    clear_saved_admin_credential_file()
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            load_seed_emails,
            save_email_queues,
            run_group_action,
            has_saved_admin_credential,
            clear_saved_admin_credential
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
