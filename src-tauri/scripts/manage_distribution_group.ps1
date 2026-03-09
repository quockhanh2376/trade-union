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

function Connect-ExchangeOnce {
    param(
        [string]$AdminAccount,
        [string]$AdminPassword
    )

    if (-not [string]::IsNullOrWhiteSpace($AdminAccount) -and -not (Test-ValidEmail -Email $AdminAccount)) {
        throw "Invalid admin account email: $AdminAccount"
    }

    $connected = $false

    if (-not [string]::IsNullOrWhiteSpace($AdminPassword)) {
        if ([string]::IsNullOrWhiteSpace($AdminAccount)) {
            throw "Admin account is required when admin password is provided."
        }

        try {
            $securePassword = ConvertTo-SecureString -String $AdminPassword -AsPlainText -Force
            $credential = New-Object System.Management.Automation.PSCredential($AdminAccount, $securePassword)
            Connect-ExchangeOnline -Credential $credential -ShowBanner:$false -ErrorAction Stop
            Write-Host "Connected with saved credential for $AdminAccount" -ForegroundColor Green
            $connected = $true
        }
        catch {
            Write-Host "Saved credential login failed for $AdminAccount. Falling back to interactive sign-in..." -ForegroundColor Yellow
        }
    }

    if (-not $connected) {
        if ([string]::IsNullOrWhiteSpace($AdminAccount)) {
            Connect-ExchangeOnline -ShowBanner:$false -ErrorAction Stop
            Write-Host "Connected via interactive sign-in." -ForegroundColor Green
        }
        else {
            Connect-ExchangeOnline -UserPrincipalName $AdminAccount -ShowBanner:$false -ErrorAction Stop
            Write-Host "Connected via interactive sign-in for $AdminAccount." -ForegroundColor Green
        }
    }
}

try {
    Ensure-ExchangeModule
    Import-Module ExchangeOnlineManagement -ErrorAction Stop

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

    $adminPassword = $env:TRADE_UNION_ADMIN_PASSWORD
    Connect-ExchangeOnce -AdminAccount $AdminUpn -AdminPassword $adminPassword

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
finally {
    try {
        Disconnect-ExchangeOnline -Confirm:$false -ErrorAction SilentlyContinue | Out-Null
    }
    catch {
        # Ignore disconnect errors
    }
}
