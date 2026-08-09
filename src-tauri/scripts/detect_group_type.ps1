param(
    [Parameter(Mandatory = $true)]
    [string]$GroupEmail,

    [string]$BundledModulesPath
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

# Shared helpers (F-10 dedup): module loading + Exchange connect parameters.
. "$PSScriptRoot/common.ps1"

function Resolve-GroupType {
    param([string]$RawType)

    switch -Regex ($RawType) {
        "^GroupMailbox$" { return "M365" }
        "^SharedMailbox$" { return "SharedMailbox" }
        "SecurityGroup|MailUniversalSecurityGroup|UniversalSecurityGroup" { return "Security" }
        "MailUniversalDistributionGroup|DynamicDistributionGroup" { return "Distribution" }
        default { return "Unknown" }
    }
}

try {
    Ensure-ExchangeModule -ModulePath $BundledModulesPath
    $connectParams = Get-ExchangeConnectParameters
    Connect-ExchangeOnline @connectParams

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
