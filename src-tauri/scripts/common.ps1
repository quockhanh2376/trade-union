# Common helpers shared by Exchange Online PowerShell scripts (F-10 dedup).
#
# This file must be dot-sourced (. "$PSScriptRoot/common.ps1"). It only defines
# functions and does NOT auto-connect, auto-run, or emit any output when
# sourced. Compatible with Windows PowerShell 5.1 and PowerShell 7+.

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
        Write-Host "ExchangeOnlineManagement module not found. Installing..." -ForegroundColor Yellow
        Install-Module -Name ExchangeOnlineManagement -Scope CurrentUser -Force -AllowClobber
    }

    Import-Module ExchangeOnlineManagement -ErrorAction Stop
}

function Get-ExchangeConnectParameters {
    param(
        [string]$AdminAccount
    )

    $params = @{
        ShowBanner = $false
        ErrorAction = "Stop"
    }

    if (-not [string]::IsNullOrWhiteSpace($AdminAccount)) {
        $params.UserPrincipalName = $AdminAccount
    }

    $connectCommand = Get-Command Connect-ExchangeOnline -ErrorAction Stop
    if ($connectCommand.Parameters.ContainsKey("DisableWAM")) {
        $params.DisableWAM = $true
    }

    return $params
}
