param(
    [Parameter(Mandatory = $true)]
    [string]$GroupEmail,

    [string]$BundledModulesPath
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

    $pathSeparator = [System.IO.Path]::PathSeparator
    $existingPaths = @($env:PSModulePath -split [regex]::Escape($pathSeparator)) | Where-Object {
        -not [string]::IsNullOrWhiteSpace($_) -and $_ -ne $Path
    }
    $env:PSModulePath = (@($Path) + $existingPaths) -join $pathSeparator
}

function Ensure-ExchangeModule {
    param([string]$ModulePath)

    Add-BundledExchangeModulePath -Path $ModulePath

    if (-not (Get-Module -ListAvailable -Name ExchangeOnlineManagement)) {
        Install-Module -Name ExchangeOnlineManagement -Scope CurrentUser -Force -AllowClobber
    }

    Import-Module ExchangeOnlineManagement -ErrorAction Stop
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
