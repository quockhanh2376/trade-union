#Requires -Version 5.1
param(
  [string]$TargetUPN,
  [string]$AdminUPN
)

$ErrorActionPreference = 'Stop'

# ---- Defaults ----
if (-not $AdminUPN)  { $AdminUPN  = 'aswhiteplus@aswhiteglobal.com' }
if (-not $TargetUPN) { $TargetUPN = $AdminUPN }

# ---- Resolve paths: read password.txt from the SAME folder as this script ----
$ScriptDir = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $PSCommandPath }
$PasswordFilePath = Join-Path $ScriptDir 'password.txt'

# ---- Self-elevate to Administrator (module install, etc.) ----
function Ensure-Admin {
  $p = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
  if (-not $p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName  = (Get-Process -Id $PID).Path
    $psi.Arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`" " + ($MyInvocation.UnboundArguments -join ' ')
    $psi.Verb      = "runas"
    [Diagnostics.Process]::Start($psi) | Out-Null
    exit
  }
}
Ensure-Admin

# ---- Read new password (first non-empty line) ----
if (-not (Test-Path -LiteralPath $PasswordFilePath)) { throw "Password file not found: $PasswordFilePath" }
$newPasswordPlain = (Get-Content -LiteralPath $PasswordFilePath -ErrorAction Stop |
  Where-Object { $_.Trim() } | Select-Object -First 1).Trim()
if (-not $newPasswordPlain) { throw "Password file is empty." }
if ($newPasswordPlain.Length -lt 8) { throw "New password looks too short (<8 chars)." }

# ---- Prefer Microsoft Graph with interactive MFA sign-in ----
Write-Host "Loading Microsoft Graph SDK..." -ForegroundColor Yellow
if (-not (Get-Module -ListAvailable -Name Microsoft.Graph.Users)) {
  Install-Module Microsoft.Graph -Force -Scope AllUsers -AllowClobber -ErrorAction Stop
}
Import-Module Microsoft.Graph.Users -ErrorAction Stop

# Interactive MFA sign-in (no stored creds). You will pick the account and approve on your phone.
Write-Host "Sign in to Microsoft Graph as $AdminUPN (MFA supported). When prompted, choose this account and approve 2FA." -ForegroundColor Yellow
try {
  Connect-MgGraph -Scopes "User.ReadWrite.All" -ContextScope Process -ErrorAction Stop
} catch {
  Write-Warning "Interactive sign-in failed or blocked. Trying device code flow (copy/paste code into https://microsoft.com/devicelogin)..."
  Connect-MgGraph -Scopes "User.ReadWrite.All" -UseDeviceCode -ContextScope Process -ErrorAction Stop
}

# ---- Change password via Graph ----
$pp = @{
  password                          = $newPasswordPlain
  forceChangePasswordNextSignIn     = $false
}
Write-Host "Changing password for $TargetUPN via Microsoft Graph..." -ForegroundColor Yellow
Update-MgUser -UserId $TargetUPN -PasswordProfile $pp -ErrorAction Stop
Write-Host "✅ Password changed successfully for $TargetUPN." -ForegroundColor Green

# ---- Cleanup ----
$newPasswordPlain = $null
if (Get-Command Disconnect-MgGraph -ErrorAction SilentlyContinue) { Disconnect-MgGraph | Out-Null }
