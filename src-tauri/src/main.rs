#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::{Deserialize, Serialize};
use std::{
    collections::HashSet,
    fs,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{mpsc, OnceLock},
    thread,
    time::Duration,
};
use tauri::{path::BaseDirectory, AppHandle, Manager};
use wait_timeout::ChildExt;

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

fn workspace_bundled_exchange_modules_path() -> PathBuf {
    workspace_root()
        .join("src-tauri")
        .join("vendor")
        .join("powershell-modules")
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
        .resolve(
            "scripts/manage_distribution_group.ps1",
            BaseDirectory::Resource,
        )
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

fn bundled_exchange_modules_path(app: &AppHandle) -> Result<PathBuf, String> {
    if let Ok(path) = std::env::var("TRADE_UNION_ROOT") {
        let candidate = PathBuf::from(path)
            .join("src-tauri")
            .join("vendor")
            .join("powershell-modules");
        if candidate.exists() {
            return Ok(candidate);
        }
    }

    let resource_path = app
        .path()
        .resolve("vendor/powershell-modules", BaseDirectory::Resource)
        .map_err(|err| format!("Cannot resolve bundled PowerShell modules: {err}"))?;
    if resource_path.exists() {
        return Ok(resource_path);
    }

    Ok(workspace_bundled_exchange_modules_path())
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

#[cfg(windows)]
fn powershell_compatible_path(path: &Path) -> PathBuf {
    let value = path.as_os_str().to_string_lossy();
    if let Some(rest) = value.strip_prefix(r"\\?\UNC\") {
        return PathBuf::from(format!(r"\\{rest}"));
    }
    if let Some(rest) = value.strip_prefix(r"\\?\") {
        return PathBuf::from(rest);
    }

    path.to_path_buf()
}

#[cfg(not(windows))]
fn powershell_compatible_path(path: &Path) -> PathBuf {
    path.to_path_buf()
}

#[cfg(windows)]
fn hidden_powershell_command() -> Command {
    use std::os::windows::process::CommandExt;

    const CREATE_NO_WINDOW: u32 = 0x08000000;

    // Prefer PowerShell 7 (pwsh.exe) when available — better ExchangeOnlineManagement support
    static PWSH_AVAILABLE: OnceLock<bool> = OnceLock::new();
    let use_pwsh = *PWSH_AVAILABLE.get_or_init(|| {
        Command::new("pwsh.exe")
            .args(["-NoProfile", "-Command", "exit 0"])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .creation_flags(CREATE_NO_WINDOW)
            .status()
            .map(|s| s.success())
            .unwrap_or(false)
    });

    let exe = if use_pwsh {
        "pwsh.exe"
    } else {
        "powershell.exe"
    };
    let mut cmd = Command::new(exe);
    cmd.creation_flags(CREATE_NO_WINDOW);
    cmd
}

#[cfg(not(windows))]
fn hidden_powershell_command() -> Command {
    Command::new("powershell")
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

/// Maximum wall-clock time allowed for a single PowerShell Exchange action
/// (Connect-ExchangeOnline + Add/Remove loop + export). Exchange modern auth
/// with MFA can take a while, so this is intentionally generous.
const POWERSHELL_ACTION_TIMEOUT: Duration = Duration::from_secs(15 * 60);

/// Outcome of running a child process with a timeout.
#[derive(Debug)]
enum TimedOutput {
    /// The process exited on its own within the timeout.
    Output(std::process::Output),
    /// The process did not exit within the timeout. It has been killed and
    /// reaped; `partial` holds whatever stdout/stderr was drained before the
    /// kill (best effort — may be incomplete).
    TimedOut {
        partial: std::process::Output,
        timeout: Duration,
    },
}

/// Spawn a configured `Command`, wait up to `timeout` for it to exit, and if
/// it is still running then kill the (direct) child and reap it so it does
/// not become a zombie.
///
/// Pipes are drained on two background threads while waiting, so a process
/// that writes more than the OS pipe buffer (a few KB on Windows) cannot
/// deadlock us by filling stdout/stderr and blocking on the next write.
///
/// Returns:
/// - `Ok(TimedOutput::Output(_))` when the child exited on its own.
/// - `Ok(TimedOutput::TimedOut { .. })` when the timeout elapsed; the child
///   has been killed + waited.
/// - `Err(_)` when the process could not be spawned.
///
/// Limitation: on Windows `child.kill()` terminates only the direct child
/// (PowerShell). It does not guarantee killing the entire process tree
/// (e.g. the Microsoft sign-in browser spawned by Exchange). Those descendants
/// are expected to exit on their own once PowerShell is killed, but this
/// helper does not perform a job-object/tree kill.
fn run_with_timeout(mut cmd: Command, timeout: Duration) -> Result<TimedOutput, String> {
    let mut child = cmd
        .spawn()
        .map_err(|err| format!("Failed to launch process: {err}"))?;

    // Drain stdout/stderr on background threads so the child cannot block on
    // a full pipe while we are busy waiting for it to exit. This is the key
    // difference from a naive `child.wait_timeout()` + post-read: without
    // draining, a child that writes more than the pipe buffer (a few KB on
    // Windows) will block on its next write and never exit, deadlocking us.
    //
    // Lifecycle contract: both reader threads are always joined before this
    // function returns. When the direct child exits or is killed+reaped, the
    // OS closes its ends of the stdout/stderr pipes; the reader threads then
    // observe EOF, send their bytes, and finish, so `recv()` + `join()`
    // returns promptly. This relies on the production fact that the child
    // (PowerShell running manage_distribution_group.ps1) does not spawn
    // explicit descendant processes that inherit these pipes — see the audit
    // in F-06. If a descendant ever did keep a pipe open, `recv()` would
    // block until that descendant exits; that is an accepted, documented
    // limitation of direct-child-only kill (no job-object tree kill here).
    let (stdout_tx, stdout_rx) = mpsc::channel::<Vec<u8>>();
    let (stderr_tx, stderr_rx) = mpsc::channel::<Vec<u8>>();
    let stdout_handle = child.stdout.take();
    let stderr_handle = child.stderr.take();
    let stdout_thread = thread::spawn(move || {
        let _ = stdout_tx.send(read_all(stdout_handle));
    });
    let stderr_thread = thread::spawn(move || {
        let _ = stderr_tx.send(read_all(stderr_handle));
    });

    match child.wait_timeout(timeout) {
        Ok(Some(status)) => {
            // Exited on its own — both readers hit EOF and send.
            let stdout = recv_join(stdout_thread, &stdout_rx);
            let stderr = recv_join(stderr_thread, &stderr_rx);
            Ok(TimedOutput::Output(std::process::Output {
                status,
                stdout,
                stderr,
            }))
        }
        Ok(None) => {
            // Timed out — kill the direct child and reap it. kill() on an
            // already-exited process returns a benign error (race); we always
            // wait() to reap regardless. After reap the OS closes the child's
            // pipe ends, so the reader threads observe EOF and finish.
            let kill_err = child.kill().err();
            let wait_err = child.wait().err();
            if kill_err.is_some() || wait_err.is_some() {
                eprintln!(
                    "run_with_timeout: kill={kill_err:?} wait={wait_err:?} (continuing with timeout result)"
                );
            }
            let stdout = recv_join(stdout_thread, &stdout_rx);
            let stderr = recv_join(stderr_thread, &stderr_rx);
            let partial = std::process::Output {
                status: std::process::ExitStatus::default(),
                stdout,
                stderr,
            };
            Ok(TimedOutput::TimedOut { partial, timeout })
        }
        Err(err) => {
            // Best-effort cleanup before propagating. After kill+wait the
            // pipes close and reader threads finish; we still join them.
            let _ = child.kill();
            let _ = child.wait();
            let _ = recv_join(stdout_thread, &stdout_rx);
            let _ = recv_join(stderr_thread, &stderr_rx);
            Err(format!("Failed to wait on process: {err}"))
        }
    }
}

/// Read a captured child pipe to EOF, returning the bytes. Accepts `None`
/// (no pipe was set up) and returns an empty buffer in that case.
fn read_all<R: std::io::Read>(mut reader: Option<R>) -> Vec<u8> {
    match reader.as_mut() {
        Some(r) => {
            let mut buf = Vec::new();
            // Ignore read errors; partial output is acceptable here.
            let _ = r.read_to_end(&mut buf);
            buf
        }
        None => Vec::new(),
    }
}

/// Receive the bytes produced by a reader thread and join the thread.
///
/// Blocks on `rx.recv()` until the reader hits EOF (after the child exits or
/// is killed+reaped and the OS closes the pipe) and sends its bytes, then
/// joins the thread. Because the reader only finishes once its pipe reaches
/// EOF, and the child's pipe ends are closed by the OS when the child is
/// reaped, this join returns promptly in practice.
///
/// This always joins — the reader thread is never detached.
fn recv_join(handle: thread::JoinHandle<()>, rx: &mpsc::Receiver<Vec<u8>>) -> Vec<u8> {
    let bytes = rx.recv().unwrap_or_default();
    let _ = handle.join();
    bytes
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
    let bundled_modules = bundled_exchange_modules_path(&app)?;
    let script_arg = powershell_compatible_path(&script);
    let queue_file_arg = powershell_compatible_path(&queue_file);
    let output_file_arg = powershell_compatible_path(&output_file);
    let bundled_modules_arg = powershell_compatible_path(&bundled_modules);

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

        let mut cmd = hidden_powershell_command();
        cmd.arg("-NoLogo")
            .arg("-NoProfile")
            .arg("-ExecutionPolicy")
            .arg("Bypass")
            .arg("-File")
            .arg(script_arg.as_os_str())
            .arg("-Action")
            .arg(act)
            .arg("-DistGroups")
            .arg(&group_arg)
            .arg("-InputFile")
            .arg(queue_file_arg.as_os_str())
            .arg("-OutputFile")
            .arg(output_file_arg.as_os_str())
            .arg("-BundledModulesPath")
            .arg(bundled_modules_arg.as_os_str())
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        if let Some(ref upn) = cleaned_admin_upn {
            cmd.arg("-AdminUpn").arg(upn);
        }

        if force_reconnect.unwrap_or(false) {
            cmd.arg("-ForceReconnect");
        }

        let output = match run_with_timeout(cmd, POWERSHELL_ACTION_TIMEOUT)? {
            TimedOutput::Output(o) => o,
            TimedOutput::TimedOut { partial, timeout } => {
                let secs = timeout.as_secs();
                let stdout = String::from_utf8_lossy(&partial.stdout).trim().to_string();
                let stderr = String::from_utf8_lossy(&partial.stderr).trim().to_string();
                return Err(build_command_error(
                    &format!("{act} action timed out after {secs} seconds and was terminated."),
                    &stdout,
                    &stderr,
                ));
            }
        };

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

    fn read_workspace_script(file_name: &str) -> String {
        let path = workspace_root()
            .join("src-tauri")
            .join("scripts")
            .join(file_name);
        fs::read_to_string(&path).unwrap_or_else(|err| panic!("read {}: {err}", path.display()))
    }

    #[cfg(windows)]
    #[test]
    fn powershell_compatible_path_removes_verbatim_drive_prefix() {
        let path = PathBuf::from(
            r"\\?\C:\Users\Zon\AppData\Local\Trade Union Group Manager\vendor\powershell-modules",
        );

        assert_eq!(
            powershell_compatible_path(&path),
            PathBuf::from(
                r"C:\Users\Zon\AppData\Local\Trade Union Group Manager\vendor\powershell-modules"
            )
        );
    }

    #[cfg(windows)]
    #[test]
    fn powershell_compatible_path_removes_verbatim_unc_prefix() {
        let path = PathBuf::from(r"\\?\UNC\server\share\Trade Union Group Manager\scripts");

        assert_eq!(
            powershell_compatible_path(&path),
            PathBuf::from(r"\\server\share\Trade Union Group Manager\scripts")
        );
    }

    #[test]
    fn exchange_script_uses_modern_auth_without_password_credentials() {
        // F-10: the connect-parameter logic (UserPrincipalName handling) now
        // lives in common.ps1, dot-sourced by manage_distribution_group.ps1.
        // Assert against common.ps1 for the UPN invariant, and against
        // manage_distribution_group.ps1 for the no-credential invariant.
        let common = read_workspace_script("common.ps1");
        let manage = read_workspace_script("manage_distribution_group.ps1");

        assert!(
            !common.contains("Connect-ExchangeOnline -Credential"),
            "Exchange Online auth must not use password credential auth because it breaks MFA accounts"
        );
        assert!(
            !manage.contains("Connect-ExchangeOnline -Credential"),
            "manage_distribution_group.ps1 must not use password credential auth"
        );
        assert!(
            common.contains("UserPrincipalName = $AdminAccount")
                || common.contains("params.UserPrincipalName = $AdminAccount"),
            "common.ps1 should pass admin UPN into the modern Exchange Online sign-in prompt"
        );
    }

    #[test]
    fn exchange_scripts_disable_wam_when_hidden_powershell_can_block_auth_ui() {
        // F-10: the shared connect-parameter logic (including the DisableWAM
        // guard) now lives in common.ps1, dot-sourced by both production
        // scripts. Assert the invariant against common.ps1.
        let script = read_workspace_script("common.ps1");
        if script.contains("Connect-ExchangeOnline") {
            assert!(
                script.contains("Parameters.ContainsKey(\"DisableWAM\")"),
                "common.ps1 should guard DisableWAM for older ExchangeOnlineManagement versions"
            );
            assert!(
                script.contains("DisableWAM"),
                "common.ps1 should disable WAM so Microsoft sign-in can open while PowerShell is hidden"
            );
            assert!(
                !script.contains("Connect-ExchangeOnline -ShowBanner:$false"),
                "common.ps1 should connect via splatted parameters so DisableWAM is applied consistently"
            );
        }
    }

    // ── run_with_timeout tests (F-06) ──────────────────────────────
    // Cross-platform: use cmd.exe on Windows, sh on Unix. Do NOT invoke
    // PowerShell or Exchange here.

    /// Cross-platform helper: a `Command` that runs a tiny built-in shell
    /// so tests don't depend on workspace scripts or network.
    fn shell_command(line: &str) -> Command {
        let mut cmd = if cfg!(windows) {
            let mut c = Command::new("cmd.exe");
            c.arg("/C").arg(line);
            c
        } else {
            let mut c = Command::new("sh");
            c.arg("-c").arg(line);
            c
        };
        cmd.stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        cmd
    }

    #[test]
    fn run_with_timeout_fast_process_exits_normally() {
        let cmd = shell_command(if cfg!(windows) {
            "echo hello"
        } else {
            "printf hello"
        });
        let result = run_with_timeout(cmd, Duration::from_secs(5));
        match result.expect("fast process should not error") {
            TimedOutput::Output(o) => {
                assert!(o.status.success(), "fast echo should succeed");
                assert!(
                    String::from_utf8_lossy(&o.stdout).contains("hello"),
                    "stdout should contain the echoed text"
                );
            }
            TimedOutput::TimedOut { .. } => panic!("fast process must not time out"),
        }
    }

    #[test]
    fn run_with_timeout_non_zero_exit_is_returned_not_error() {
        // Exit code 3 — non-zero but a normal exit (not timeout, not spawn error).
        let line = if cfg!(windows) { "exit /B 3" } else { "exit 3" };
        let cmd = shell_command(line);
        let result = run_with_timeout(cmd, Duration::from_secs(5));
        match result.expect("non-zero exit should not error") {
            TimedOutput::Output(o) => {
                assert_eq!(o.status.code(), Some(3), "exit code should be 3");
                assert!(!o.status.success());
            }
            TimedOutput::TimedOut { .. } => panic!("must not time out"),
        }
    }

    #[test]
    fn run_with_timeout_captures_stdout_and_stderr_separately() {
        let line = if cfg!(windows) {
            // cmd.exe: write to stdout then stderr.
            "echo out-msg 1>nul 2>&1 & echo out-msg & echo err-msg 1>&2"
        } else {
            "printf 'out-msg\\n'; printf 'err-msg\\n' 1>&2"
        };
        let cmd = shell_command(line);
        match run_with_timeout(cmd, Duration::from_secs(5)).expect("ok") {
            TimedOutput::Output(o) => {
                let out = String::from_utf8_lossy(&o.stdout);
                let err = String::from_utf8_lossy(&o.stderr);
                assert!(out.contains("out-msg"), "stdout: {out}");
                assert!(err.contains("err-msg"), "stderr: {err}");
            }
            TimedOutput::TimedOut { .. } => panic!("must not time out"),
        }
    }

    #[test]
    fn run_with_timeout_spawn_failure_returns_error() {
        // A non-existent executable cannot be spawned -> Err, not a timeout.
        let mut cmd = Command::new("this-binary-does-not-exist-12345");
        cmd.stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        let result = run_with_timeout(cmd, Duration::from_secs(5));
        assert!(
            result.is_err(),
            "spawn failure should return Err, got: {result:?}"
        );
    }

    #[test]
    fn run_with_timeout_kills_and_reports_on_timeout() {
        // A sleep that outlasts the timeout. Run a direct long-running process
        // (no shell wrapper) so that killing the direct child closes the pipes
        // and the reader threads join promptly. This mirrors the production
        // shape (direct PowerShell child, no explicit descendant that inherits
        // the pipes).
        //
        // What this test proves:
        //  - The helper returns `TimedOut` (not `Output`): partial output is
        //    NOT treated as success.
        //  - The helper returns well before the child's natural 30s lifetime
        //    would end (elapsed < 15s). Returning promptly is only possible if
        //    the child was killed and its pipes closed so the reader threads
        //    could join. If kill+reap did not happen, `recv()`/`join()` would
        //    block until the 30s sleep finished, blowing the 15s budget.
        //  What this test does NOT prove:
        //  - It does not observe the child PID or ExitStatus after kill, so it
        //    is indirect evidence of reaping rather than a direct assertion.
        let mut cmd = if cfg!(windows) {
            // ping with no output redirect; -n 30 sleeps ~29s.
            let mut c = Command::new("ping.exe");
            c.arg("-n").arg("30").arg("127.0.0.1");
            c
        } else {
            let mut c = Command::new("sleep");
            c.arg("30");
            c
        };
        cmd.stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        let timeout = Duration::from_secs(1);
        let start = std::time::Instant::now();
        let result = run_with_timeout(cmd, timeout);
        let elapsed = start.elapsed();

        match result.expect("timeout path should not return Err") {
            TimedOutput::TimedOut { timeout: t, .. } => {
                assert_eq!(t, timeout, "reported timeout should match input");
                assert!(
                    elapsed < Duration::from_secs(15),
                    "should return soon after timeout (kill closes pipes, readers join), took {elapsed:?}"
                );
            }
            TimedOutput::Output(_) => panic!("long sleep must time out, not exit cleanly"),
        }
    }

    #[test]
    fn run_with_timeout_does_not_deadlock_on_large_stdout() {
        // Write >= 1 MB to stdout — far above the Windows pipe buffer (~4-64KB).
        // A naive `wait_timeout` + post-read would deadlock here: the child
        // would block on a full pipe and never exit. The thread-drain design
        // keeps the pipe empty so the child exits on its own within the timeout.
        let line = if cfg!(windows) {
            // cmd.exe /C uses single % for loop variables (%% is for batch files).
            // Print a ~1KB line 1100 times ≈ 1.1 MB.
            "for /L %i in (1,1,1100) do @echo AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
        } else {
            "yes A | head -c 1100000"
        };
        let cmd = shell_command(line);
        let start = std::time::Instant::now();
        let result = run_with_timeout(cmd, Duration::from_secs(20));
        let elapsed = start.elapsed();

        match result.expect("large output should not error") {
            TimedOutput::Output(o) => {
                assert!(
                    o.stdout.len() >= 1_000_000,
                    "expected >=1MB captured, got {} bytes",
                    o.stdout.len()
                );
                assert!(
                    elapsed < Duration::from_secs(15),
                    "large-output run should finish fast (no deadlock), took {elapsed:?}"
                );
            }
            TimedOutput::TimedOut { .. } => {
                panic!("large-output run must not time out (would indicate pipe deadlock)")
            }
        }
    }

    #[test]
    fn run_with_timeout_captures_large_stderr_without_deadlock() {
        // Same as the stdout test but writes >= 1 MB to stderr. The stderr
        // drain thread must keep that pipe empty too, or the child would
        // block and we would time out.
        let line = if cfg!(windows) {
            // Write the marker then ~1MB of filler to stderr (1>&2).
            "for /L %i in (1,1,1100) do @echo BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB 1>&2"
        } else {
            "yes B 1>&2 | head -c 1100000"
        };
        let cmd = shell_command(line);
        let start = std::time::Instant::now();
        let result = run_with_timeout(cmd, Duration::from_secs(20));
        let elapsed = start.elapsed();

        match result.expect("large stderr should not error") {
            TimedOutput::Output(o) => {
                assert!(
                    o.stderr.len() >= 1_000_000,
                    "expected >=1MB stderr captured, got {} bytes",
                    o.stderr.len()
                );
                assert!(
                    elapsed < Duration::from_secs(15),
                    "large-stderr run should finish fast (no deadlock), took {elapsed:?}"
                );
            }
            TimedOutput::TimedOut { .. } => {
                panic!("large-stderr run must not time out (would indicate pipe deadlock)")
            }
        }
    }

    #[test]
    fn run_with_timeout_drains_stdout_and_stderr_simultaneously() {
        // Both pipes filled beyond the buffer at the same time. A single
        // reader thread (or sequential reads) would deadlock on one while
        // draining the other. The two-thread design keeps both drained.
        let line = if cfg!(windows) {
            // Interleave: 1100 lines to stdout (C...) then 1100 to stderr (D...).
            "(for /L %i in (1,1,1100) do @echo CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC) & (for /L %i in (1,1,1100) do @echo DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD 1>&2)"
        } else {
            // Write ~1MB to stdout and ~1MB to stderr concurrently. Run both
            // writers under a single shell so they share the same lifetime and
            // both pipes are full at once.
            "(yes C | head -c 1100000) ; (yes D 1>&2 | head -c 1100000)"
        };
        let cmd = shell_command(line);
        let start = std::time::Instant::now();
        let result = run_with_timeout(cmd, Duration::from_secs(20));
        let elapsed = start.elapsed();

        match result.expect("dual large output should not error") {
            TimedOutput::Output(o) => {
                assert!(
                    o.stdout.len() >= 1_000_000,
                    "expected >=1MB stdout, got {} bytes",
                    o.stdout.len()
                );
                assert!(
                    o.stderr.len() >= 1_000_000,
                    "expected >=1MB stderr, got {} bytes",
                    o.stderr.len()
                );
                assert!(
                    elapsed < Duration::from_secs(15),
                    "dual-output run should finish fast (no deadlock), took {elapsed:?}"
                );
            }
            TimedOutput::TimedOut { .. } => {
                panic!("dual-output run must not time out (would indicate pipe deadlock)")
            }
        }
    }

    #[test]
    fn run_with_timeout_after_partial_output_reports_timeout_not_success() {
        // Write a marker to stdout, then sleep past the timeout. The helper
        // must report TimedOut (not treat the partial output as a success),
        // and the direct child must be killed + reaped.
        //
        // Uses a direct process (no shell wrapper) so killing the direct
        // child closes the pipe and the reader joins promptly. Mirrors the
        // production shape where the direct child is the PowerShell process.
        let mut cmd = if cfg!(windows) {
            // powershell.exe is the direct child; Write-Output flushes to the
            // pipe, then Start-Sleep keeps it alive past the timeout.
            let mut c = Command::new("powershell.exe");
            c.arg("-NoProfile")
                .arg("-Command")
                .arg("Write-Output 'PARTIAL-BEFORE-TIMEOUT'; Start-Sleep -Seconds 30");
            c
        } else {
            let mut c = Command::new("sh");
            c.arg("-c")
                .arg("printf 'PARTIAL-BEFORE-TIMEOUT\\n'; sleep 30");
            c
        };
        cmd.stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        let timeout = Duration::from_secs(2);
        let start = std::time::Instant::now();
        let result = run_with_timeout(cmd, timeout);
        let elapsed = start.elapsed();

        match result.expect("partial-then-timeout should not error") {
            TimedOutput::TimedOut {
                timeout: t,
                partial,
            } => {
                assert_eq!(t, timeout, "reported timeout should match input");
                assert!(
                    elapsed < Duration::from_secs(15),
                    "should return soon after timeout (kill closes the pipe, reader joins), took {elapsed:?}"
                );
                // The partial marker should have been drained before the kill.
                let out = String::from_utf8_lossy(&partial.stdout);
                assert!(
                    out.contains("PARTIAL-BEFORE-TIMEOUT"),
                    "partial stdout should contain the marker written before timeout, got: {out}"
                );
            }
            TimedOutput::Output(_) => {
                panic!("must report timeout, not success, even with partial output")
            }
        }
    }

    #[test]
    fn powershell_action_timeout_is_fifteen_minutes() {
        // Pin the configured timeout so a future change is conscious.
        assert_eq!(POWERSHELL_ACTION_TIMEOUT, Duration::from_secs(15 * 60));
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
