param(
    [Parameter(Mandatory = $true)]
    [string]$GroupEmail
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

function Ensure-ExchangeModule {
    if (-not (Get-Module -ListAvailable -Name ExchangeOnlineManagement)) {
        Install-Module -Name ExchangeOnlineManagement -Scope CurrentUser -Force -AllowClobber
    }
}

function Resolve-GroupType {
    param([string]$RawType)

    switch -Regex ($RawType) {
        "^GroupMailbox$" { return "M365" }
        "SecurityGroup|MailUniversalSecurityGroup|UniversalSecurityGroup" { return "Security" }
        "MailUniversalDistributionGroup|DynamicDistributionGroup" { return "Distribution" }
        default { return "Unknown" }
    }
}

try {
    Ensure-ExchangeModule
    Import-Module ExchangeOnlineManagement -ErrorAction Stop
    Connect-ExchangeOnline -ShowBanner:$false -ErrorAction Stop

    $recipient = Get-Recipient -Identity $GroupEmail -ErrorAction Stop
    $rawType = [string]$recipient.RecipientTypeDetails
    $groupType = Resolve-GroupType -RawType $rawType

    $payload = [ordered]@{
        groupType = $groupType
        rawType = $rawType
        displayName = [string]$recipient.DisplayName
        primarySmtpAddress = [string]$recipient.PrimarySmtpAddress
        graphAllowed = ($groupType -ne "Distribution")
    }

    $payload | ConvertTo-Json -Compress | Write-Output
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
