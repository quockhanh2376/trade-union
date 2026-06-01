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
    Ensure-ExchangeModule
    Import-Module ExchangeOnlineManagement -ErrorAction Stop

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

    # Detect if target is a Shared Mailbox
    $isSharedMailbox = $false
    try {
        $recipient = Get-Recipient -Identity $DistGroup -ErrorAction Stop
        $isSharedMailbox = ([string]$recipient.RecipientTypeDetails) -eq "SharedMailbox"
    }
    catch {}

    # Execute action
    if ($isSharedMailbox) {
        if ($Action -eq "Add") {
            Add-MailboxPermission -Identity $DistGroup -User $trimmed -AccessRights FullAccess -AutoMapping $false -ErrorAction Stop | Out-Null
            Write-Host "Added: $trimmed"
        }
        else {
            Remove-MailboxPermission -Identity $DistGroup -User $trimmed -AccessRights FullAccess -Confirm:$false -ErrorAction Stop | Out-Null
            Write-Host "Removed: $trimmed"
        }
    }
    else {
        if ($Action -eq "Add") {
            Add-DistributionGroupMember -Identity $DistGroup -Member $trimmed -BypassSecurityGroupManagerCheck -ErrorAction Stop
            Write-Host "Added: $trimmed"
        }
        else {
            Remove-DistributionGroupMember -Identity $DistGroup -Member $trimmed -BypassSecurityGroupManagerCheck -Confirm:$false -ErrorAction Stop
            Write-Host "Removed: $trimmed"
        }
    }

    # NOTE: We intentionally do NOT disconnect here so the session stays alive for subsequent calls
}
catch {
    Write-Error $_
    exit 1
}
