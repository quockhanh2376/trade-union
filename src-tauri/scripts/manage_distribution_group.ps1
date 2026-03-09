param(
    [Parameter(Mandatory = $true)]
    [ValidateSet("Add", "Remove")]
    [string]$Action,

    [Parameter(Mandatory = $true)]
    [string]$DistGroup,

    [Parameter(Mandatory = $true)]
    [string]$InputFile,

    [Parameter(Mandatory = $true)]
    [string]$OutputFile,

    [switch]$ForceReconnect
)

$ErrorActionPreference = "Stop"

function Ensure-ExchangeModule {
    if (-not (Get-Module -ListAvailable -Name ExchangeOnlineManagement)) {
        Write-Host "ExchangeOnlineManagement module not found. Installing..." -ForegroundColor Yellow
        Install-Module -Name ExchangeOnlineManagement -Scope CurrentUser -Force -AllowClobber
    }
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

try {
    Ensure-ExchangeModule
    Import-Module ExchangeOnlineManagement -ErrorAction Stop

    # If ForceReconnect, disconnect any existing session first
    if ($ForceReconnect) {
        try {
            Disconnect-ExchangeOnline -Confirm:$false -ErrorAction SilentlyContinue | Out-Null
        }
        catch {}
        Write-Host "Force reconnect: will prompt for fresh credentials." -ForegroundColor Yellow
    }

    Connect-ExchangeOnline -ShowBanner:$false -ErrorAction Stop

    $emails = Read-EmailList -Path $InputFile
    if ($emails.Count -eq 0) {
        Write-Host "No valid emails found in $InputFile"
    }

    # Keep processing compatible with Windows PowerShell 5.1 (no -Parallel support)
    $successCount = 0
    $failedCount = 0

    foreach ($email in $emails) {
        try {
            if ($Action -eq "Add") {
                Add-DistributionGroupMember -Identity $DistGroup -Member $email -BypassSecurityGroupManagerCheck -ErrorAction Stop
            }
            else {
                Remove-DistributionGroupMember -Identity $DistGroup -Member $email -BypassSecurityGroupManagerCheck -Confirm:$false -ErrorAction Stop
            }

            $successCount++
            Write-Host "$Action success: $email" -ForegroundColor Green
        }
        catch {
            $failedCount++
            Write-Host "$Action failed: $email" -ForegroundColor Red
            Write-Host $_ -ForegroundColor Red
        }
    }

    $members = Get-DistributionGroupMember -Identity $DistGroup -ErrorAction Stop
    $members | Select-Object -ExpandProperty PrimarySmtpAddress | Out-File -FilePath $OutputFile -Encoding UTF8

    Write-Host "Completed $Action for group $DistGroup"
    Write-Host "Success: $successCount | Failed: $failedCount"
    Write-Host "Updated members exported to $OutputFile"

    # Output structured result for the Rust backend to parse
    $resultJson = @{success = $successCount; failed = $failedCount } | ConvertTo-Json -Compress
    Write-Output "RESULT_JSON:$resultJson"
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
