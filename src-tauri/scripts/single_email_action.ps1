param(
    [Parameter(Mandatory = $true)]
    [ValidateSet("Add", "Remove")]
    [string]$Action,

    [Parameter(Mandatory = $true)]
    [string]$DistGroup,

    [Parameter(Mandatory = $true)]
    [string]$Email,

    [switch]$ForceReconnect,

    [switch]$IsFirst
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

function Ensure-ExchangeModule {
    if (-not (Get-Module -ListAvailable -Name ExchangeOnlineManagement)) {
        Install-Module -Name ExchangeOnlineManagement -Scope CurrentUser -Force -AllowClobber
    }
}

function Test-ValidEmail {
    param([string]$Email)
    return $Email -match "^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$"
}

function Is-AlreadyConnected {
    try {
        $null = Get-ConnectionInformation -ErrorAction Stop
        return $true
    }
    catch {
        return $false
    }
}

try {
    Ensure-ExchangeModule
    Import-Module ExchangeOnlineManagement -ErrorAction Stop

    # Handle connection: on first call or force reconnect, ensure fresh session
    if ($ForceReconnect) {
        try {
            Disconnect-ExchangeOnline -Confirm:$false -ErrorAction SilentlyContinue | Out-Null
        } catch {}
        Connect-ExchangeOnline -ShowBanner:$false -ErrorAction Stop
    }
    elseif ($IsFirst) {
        if (-not (Is-AlreadyConnected)) {
            Connect-ExchangeOnline -ShowBanner:$false -ErrorAction Stop
        }
    }
    # For subsequent calls (not first, not force), try to use existing session
    # If no session exists, connect
    else {
        if (-not (Is-AlreadyConnected)) {
            Connect-ExchangeOnline -ShowBanner:$false -ErrorAction Stop
        }
    }

    # Validate email
    $trimmed = $Email.Trim().ToLowerInvariant()
    if (-not (Test-ValidEmail -Email $trimmed)) {
        Write-Error "Invalid email format: $trimmed"
        exit 1
    }

    # Execute action
    if ($Action -eq "Add") {
        Add-DistributionGroupMember -Identity $DistGroup -Member $trimmed -BypassSecurityGroupManagerCheck -ErrorAction Stop
        Write-Host "Added: $trimmed"
    }
    else {
        Remove-DistributionGroupMember -Identity $DistGroup -Member $trimmed -BypassSecurityGroupManagerCheck -Confirm:$false -ErrorAction Stop
        Write-Host "Removed: $trimmed"
    }

    # NOTE: We intentionally do NOT disconnect here so the session stays alive for subsequent calls
}
catch {
    Write-Error $_
    exit 1
}
