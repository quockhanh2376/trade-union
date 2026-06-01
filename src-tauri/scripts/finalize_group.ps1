param(
    [Parameter(Mandatory = $true)]
    [string]$DistGroup,

    [Parameter(Mandatory = $true)]
    [string]$OutputFile
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

function Ensure-ExchangeModule {
    if (-not (Get-Module -ListAvailable -Name ExchangeOnlineManagement)) {
        Install-Module -Name ExchangeOnlineManagement -Scope CurrentUser -Force -AllowClobber
    }
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

try {
    Ensure-ExchangeModule
    Import-Module ExchangeOnlineManagement -ErrorAction Stop

    if (-not (Is-AlreadyConnected)) {
        $connectParams = Get-ExchangeConnectParameters
        Connect-ExchangeOnline @connectParams
    }

    # Detect if target is a Shared Mailbox
    $isSharedMailbox = $false
    try {
        $recipient = Get-Recipient -Identity $DistGroup -ErrorAction Stop
        $isSharedMailbox = ([string]$recipient.RecipientTypeDetails) -eq "SharedMailbox"
    }
    catch {}

    if ($isSharedMailbox) {
        $members = Get-MailboxPermission -Identity $DistGroup -ErrorAction Stop |
            Where-Object { $_.User -notlike "NT AUTHORITY\*" -and $_.IsInherited -eq $false }
        $members | Select-Object -ExpandProperty User | Out-File -FilePath $OutputFile -Encoding UTF8
        Write-Host "Updated members exported to $OutputFile"
        Write-Host "Total members: $($members.Count)"
    }
    else {
        $members = Get-DistributionGroupMember -Identity $DistGroup -ErrorAction Stop
        $members | Select-Object -ExpandProperty PrimarySmtpAddress | Out-File -FilePath $OutputFile -Encoding UTF8
        Write-Host "Updated members exported to $OutputFile"
        Write-Host "Total members: $($members.Count)"
    }
}
catch {
    Write-Error $_
    exit 1
}
finally {
    try {
        Disconnect-ExchangeOnline -Confirm:$false -ErrorAction SilentlyContinue | Out-Null
    }
    catch {
        # Ignore disconnect errors
    }
}
