#Requires -Version 5.1
param(
    [Parameter(Mandatory = $true)]
    [string]$TargetUPN,

    [Parameter(Mandatory = $true)]
    [string]$NewPassword,

    [string]$AdminUPN = "",

    [switch]$ForceChangePasswordNextSignIn
)

$ErrorActionPreference = 'Stop'

# ---- Minimize Background Console Window Immediately ----
try {
    if (-not ("Native.ConsoleWin32" -as [type])) {
        Add-Type -MemberDefinition @'
[DllImport("user32.dll")]
public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
[DllImport("kernel32.dll")]
public static extern IntPtr GetConsoleWindow();
'@ -Name "ConsoleWin32" -Namespace "Native" -ErrorAction SilentlyContinue | Out-Null
    }

    if ("Native.ConsoleWin32" -as [type]) {
        $hwnd = [Native.ConsoleWin32]::GetConsoleWindow()
        if ($hwnd -ne [System.IntPtr]::Zero) {
            # SW_MINIMIZE = 6
            [Native.ConsoleWin32]::ShowWindowAsync($hwnd, 6) | Out-Null
        }
    }
} catch {
    # Non-critical: continue even if window minimization fails
}

# ---- Input Validation ----
$TargetUPN = $TargetUPN.Trim()
if ([string]::IsNullOrWhiteSpace($TargetUPN)) {
    throw "Target email cannot be empty."
}

if ($NewPassword.Length -lt 8) {
    throw "New password must be at least 8 characters long."
}

# ---- Module Loading ----
Write-Host "Checking Microsoft.Graph.Users module..." -ForegroundColor Yellow
if (-not (Get-Module -ListAvailable -Name Microsoft.Graph.Users)) {
    Write-Host "Installing Microsoft.Graph.Users module (Scope CurrentUser)..." -ForegroundColor Yellow
    Install-Module -Name Microsoft.Graph.Users -Scope CurrentUser -Force -AllowClobber -ErrorAction Stop
}

Import-Module Microsoft.Graph.Users -ErrorAction Stop

# ---- Interactive MFA Sign-In ----
if (-not [string]::IsNullOrWhiteSpace($AdminUPN)) {
    Write-Host "Sign in to Microsoft Graph as $AdminUPN (MFA supported)..." -ForegroundColor Yellow
} else {
    Write-Host "Sign in to Microsoft Graph (MFA supported)..." -ForegroundColor Yellow
}

$connectParams = @{
    Scopes = @("User.ReadWrite.All")
    ContextScope = "Process"
    NoWelcome = $true
    ErrorAction = "Stop"
}
if (-not [string]::IsNullOrWhiteSpace($AdminUPN)) {
    $connectParams["LoginHint"] = $AdminUPN
}

$connectSucceeded = $false
try {
    Connect-MgGraph @connectParams
    $connectSucceeded = $true
} catch {
    Write-Warning "Standard interactive sign-in failed or prompt blocked. Trying device code flow..."
    try {
        Start-Process "https://login.microsoft.com/device" -ErrorAction SilentlyContinue
        Connect-MgGraph -Scopes "User.ReadWrite.All" -UseDeviceCode -ContextScope Process -NoWelcome -ErrorAction Stop
        $connectSucceeded = $true
    } catch {
        throw "Failed to authenticate with Microsoft Graph: $_"
    }
}

# ---- Password Update ----
$pp = @{
    Password = $NewPassword
    ForceChangePasswordNextSignIn = [bool]$ForceChangePasswordNextSignIn
}

Write-Host "Changing password for $TargetUPN via Microsoft Graph..." -ForegroundColor Yellow
try {
    Update-MgUser -UserId $TargetUPN -PasswordProfile $pp -ErrorAction Stop
    Write-Host "Password changed successfully for $TargetUPN." -ForegroundColor Green

    $result = @{
        success = $true
        targetEmail = $TargetUPN
        message = "Password changed successfully for $TargetUPN."
    } | ConvertTo-Json -Compress

    Write-Output "RESULT_JSON:$result"
} catch {
    $errMessage = $_.Exception.Message
    Write-Host "Failed to update password for $($TargetUPN): $errMessage" -ForegroundColor Red

    $result = @{
        success = $false
        targetEmail = $TargetUPN
        message = $errMessage
    } | ConvertTo-Json -Compress

    Write-Output "RESULT_JSON:$result"
} finally {
    $NewPassword = $null
    $pp = $null
    if (Get-Command Disconnect-MgGraph -ErrorAction SilentlyContinue) {
        Disconnect-MgGraph | Out-Null
    }
}
