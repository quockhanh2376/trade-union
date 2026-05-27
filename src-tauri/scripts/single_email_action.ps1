param(
    [Parameter(Mandatory = $true)]
    [ValidateSet("Add", "Remove")]
    [string]$Action,

    [Parameter(Mandatory = $true)]
    [string]$DistGroup,

    [Parameter(Mandatory = $true)]
    [string]$Email,

    [string]$BundledModulesPath,

    [switch]$ForceReconnect,

    [switch]$IsFirst
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

function Add-BundledExchangeModulePath {
    param([string]$Path)

    if ([string]::IsNullOrWhiteSpace($Path)) {
        return
    }
    if (-not (Test-Path -Path $Path -PathType Container)) {
        return
    }
    if (-not (Test-Path -Path (Join-Path -Path $Path -ChildPath "ExchangeOnlineManagement") -PathType Container)) {
        return
    }

    $existingPaths = @($env:PSModulePath -split ";") | Where-Object {
        -not [string]::IsNullOrWhiteSpace($_) -and $_ -ne $BundledModulesPath
    }
    $env:PSModulePath = "$BundledModulesPath;$($existingPaths -join ';')"
}

function Ensure-ExchangeModule {
    param([string]$ModulePath)

    Add-BundledExchangeModulePath -Path $ModulePath

    if (-not (Get-Module -ListAvailable -Name ExchangeOnlineManagement)) {
        Install-Module -Name ExchangeOnlineManagement -Scope CurrentUser -Force -AllowClobber
    }

    Import-Module ExchangeOnlineManagement -ErrorAction Stop
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

function Get-ExchangeConnectParameters {
    $params = @{
        ShowBanner = $false
        ErrorAction = "Stop"
    }

    $connectCommand = Get-Command Connect-ExchangeOnline -ErrorAction Stop
    if ($connectCommand.Parameters.ContainsKey("DisableWAM")) {
        $params.DisableWAM = $true
    }

    return $params
}

function Connect-ExchangeWithHiddenConsoleAuth {
    $connectParams = Get-ExchangeConnectParameters
    Connect-ExchangeOnline @connectParams
}

try {
    Ensure-ExchangeModule -ModulePath $BundledModulesPath

    # Handle connection: on first call or force reconnect, ensure fresh session
    if ($ForceReconnect) {
        try {
            Disconnect-ExchangeOnline -Confirm:$false -ErrorAction SilentlyContinue | Out-Null
        } catch {}
        Connect-ExchangeWithHiddenConsoleAuth
    }
    elseif ($IsFirst) {
        if (-not (Is-AlreadyConnected)) {
            Connect-ExchangeWithHiddenConsoleAuth
        }
    }
    # For subsequent calls (not first, not force), try to use existing session
    # If no session exists, connect
    else {
        if (-not (Is-AlreadyConnected)) {
            Connect-ExchangeWithHiddenConsoleAuth
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
