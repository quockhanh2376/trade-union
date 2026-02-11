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

    # Thread-safe counters using synchronized hashtable
    $results = [hashtable]::Synchronized(@{
            Success = 0
            Failed  = 0
        })

    # Parallel processing with throttle limit of 10 concurrent jobs
    $emails | ForEach-Object -Parallel {
        $email = $_
        $action = $using:Action
        $distGroup = $using:DistGroup
        $results = $using:results

        try {
            if ($action -eq "Add") {
                Add-DistributionGroupMember -Identity $distGroup -Member $email -BypassSecurityGroupManagerCheck -ErrorAction Stop
            }
            else {
                Remove-DistributionGroupMember -Identity $distGroup -Member $email -BypassSecurityGroupManagerCheck -Confirm:$false -ErrorAction Stop
            }

            $results.Success++
            Write-Host "$action success: $email" -ForegroundColor Green
        }
        catch {
            $results.Failed++
            Write-Host "$action failed: $email" -ForegroundColor Red
            Write-Host $_ -ForegroundColor Red
        }
    } -ThrottleLimit 10

    $members = Get-DistributionGroupMember -Identity $DistGroup -ErrorAction Stop
    $members | Select-Object -ExpandProperty PrimarySmtpAddress | Out-File -FilePath $OutputFile -Encoding UTF8

    Write-Host "Completed $Action for group $DistGroup"
    Write-Host "Success: $($results.Success) | Failed: $($results.Failed)"
    Write-Host "Updated members exported to $OutputFile"

    # Output structured result for the Rust backend to parse
    $resultJson = @{success = $results.Success; failed = $results.Failed } | ConvertTo-Json -Compress
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
