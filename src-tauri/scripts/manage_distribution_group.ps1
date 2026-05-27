param(
    [Parameter(Mandatory = $true)]
    [ValidateSet("Add", "Remove")]
    [string]$Action,

    [Parameter(Mandatory = $true)]
    [string]$DistGroups,

    [Parameter(Mandatory = $true)]
    [string]$InputFile,

    [Parameter(Mandatory = $true)]
    [string]$OutputFile,

    [string]$AdminUpn,

    [string]$BundledModulesPath,

    [switch]$ForceReconnect
)

$ErrorActionPreference = "Stop"

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
        Write-Host "ExchangeOnlineManagement module not found. Installing..." -ForegroundColor Yellow
        Install-Module -Name ExchangeOnlineManagement -Scope CurrentUser -Force -AllowClobber
    }

    Import-Module ExchangeOnlineManagement -ErrorAction Stop
}

function Test-ValidEmail {
    param([string]$Email)
    return $Email -match "^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$"
}

function Read-EmailList {
    param([string]$Path)

    if (-not (Test-Path -Path $Path)) {
        return @()
    }

    $items = New-Object System.Collections.Generic.List[string]
    $unique = New-Object System.Collections.Generic.HashSet[string]

    foreach ($line in (Get-Content -Path $Path -ErrorAction Stop)) {
        $value = $line.Trim().ToLowerInvariant()
        if ([string]::IsNullOrWhiteSpace($value)) {
            continue
        }
        if (-not (Test-ValidEmail -Email $value)) {
            Write-Host "Skipping invalid email: $value" -ForegroundColor Yellow
            continue
        }
        if ($unique.Add($value)) {
            $items.Add($value) | Out-Null
        }
    }

    return $items.ToArray()
}

function Read-GroupList {
    param([string]$Raw)

    $items = New-Object System.Collections.Generic.List[string]
    $unique = New-Object System.Collections.Generic.HashSet[string]

    foreach ($token in ($Raw -split "[,;\s]+")) {
        $value = $token.Trim().ToLowerInvariant()
        if ([string]::IsNullOrWhiteSpace($value)) {
            continue
        }
        if (-not (Test-ValidEmail -Email $value)) {
            Write-Host "Skipping invalid distribution group: $value" -ForegroundColor Yellow
            continue
        }
        if ($unique.Add($value)) {
            $items.Add($value) | Out-Null
        }
    }

    return $items.ToArray()
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

function Connect-ExchangeOnce {
    param(
        [string]$AdminAccount
    )

    if (-not [string]::IsNullOrWhiteSpace($AdminAccount) -and -not (Test-ValidEmail -Email $AdminAccount)) {
        throw "Invalid admin account email: $AdminAccount"
    }

    $connectParams = Get-ExchangeConnectParameters -AdminAccount $AdminAccount
    Connect-ExchangeOnline @connectParams

    if ([string]::IsNullOrWhiteSpace($AdminAccount)) {
        Write-Host "Connected via Microsoft sign-in." -ForegroundColor Green
    }
    else {
        Write-Host "Connected via Microsoft sign-in for $AdminAccount." -ForegroundColor Green
    }
}

try {
    Ensure-ExchangeModule -ModulePath $BundledModulesPath

    if ($ForceReconnect) {
        try {
            Disconnect-ExchangeOnline -Confirm:$false -ErrorAction SilentlyContinue | Out-Null
        }
        catch {}
        Write-Host "Force reconnect enabled. Opening fresh sign-in." -ForegroundColor Yellow
    }

    $groups = Read-GroupList -Raw $DistGroups
    if ($groups.Count -eq 0) {
        throw "No valid distribution groups found."
    }

    $emails = Read-EmailList -Path $InputFile
    if ($emails.Count -eq 0) {
        Write-Host "No valid emails found in $InputFile"
    }

    Connect-ExchangeOnce -AdminAccount $AdminUpn

    $successCount = 0
    $failedCount = 0
    $processedCount = 0
    $groupIndex = 0
    $lastExportedGroup = $null
    $details = New-Object System.Collections.Generic.List[object]

    foreach ($group in $groups) {
        $groupIndex++
        Write-Host "Running $Action for $group ($groupIndex/$($groups.Count))..."

        foreach ($email in $emails) {
            $processedCount++
            try {
                if ($Action -eq "Add") {
                    Add-DistributionGroupMember -Identity $group -Member $email -BypassSecurityGroupManagerCheck -ErrorAction Stop
                }
                else {
                    Remove-DistributionGroupMember -Identity $group -Member $email -BypassSecurityGroupManagerCheck -Confirm:$false -ErrorAction Stop
                }

                $successCount++
                $details.Add([PSCustomObject]@{
                        email = $email
                        group = $group
                        status = "Ok"
                        message = ""
                    }) | Out-Null
                Write-Host "$Action success [$group]: $email" -ForegroundColor Green
            }
            catch {
                $failedCount++
                $message = $_.Exception.Message
                $details.Add([PSCustomObject]@{
                        email = $email
                        group = $group
                        status = "Fail"
                        message = $message
                    }) | Out-Null
                Write-Host "$Action failed [$group]: $email" -ForegroundColor Red
                Write-Host "Error [$group][$email]: $message" -ForegroundColor Red
            }
        }

        try {
            $members = Get-DistributionGroupMember -Identity $group -ErrorAction Stop
            $members | Select-Object -ExpandProperty PrimarySmtpAddress | Out-File -FilePath $OutputFile -Encoding UTF8
            $lastExportedGroup = $group
            Write-Host "Updated members exported to $OutputFile for $group"
        }
        catch {
            Write-Host "Export members failed for [$group]: $($_.Exception.Message)" -ForegroundColor Yellow
        }
    }

    Write-Host "Completed $Action for $($groups.Count) group(s)."
    Write-Host "Success: $successCount | Failed: $failedCount"
    if ($null -ne $lastExportedGroup) {
        Write-Host "Last exported group: $lastExportedGroup"
    }

    $resultJson = @{
        success = $successCount
        failed = $failedCount
        processed = $processedCount
        details = $details
    } | ConvertTo-Json -Compress -Depth 5
    Write-Output "RESULT_JSON:$resultJson"
}
catch {
    Write-Error $_
    exit 1
}
