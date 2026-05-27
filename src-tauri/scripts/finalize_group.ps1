param(
    [Parameter(Mandatory = $true)]
    [string]$DistGroup,

    [Parameter(Mandatory = $true)]
    [string]$OutputFile,

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
    Ensure-ExchangeModule -ModulePath $BundledModulesPath

    if (-not (Is-AlreadyConnected)) {
        $connectParams = Get-ExchangeConnectParameters
        Connect-ExchangeOnline @connectParams
    }

    $members = Get-DistributionGroupMember -Identity $DistGroup -ErrorAction Stop
    $members | Select-Object -ExpandProperty PrimarySmtpAddress | Out-File -FilePath $OutputFile -Encoding UTF8

    Write-Host "Updated members exported to $OutputFile"
    Write-Host "Total members: $($members.Count)"
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
