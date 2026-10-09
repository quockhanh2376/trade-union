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

# Shared helpers (F-10 dedup): module loading + Exchange connect parameters.
. "$PSScriptRoot/common.ps1"

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

function Get-FriendlyActionError {
    param([string]$Message)

    if ($Message -match "already\s+(exist|a\s+member|subscri)" -or
        $Message -match "IdentityAlreadyMember" -or
        $Message -match "MemberAlreadyExists" -or
        $Message -match "AlreadyMember") {
        return "Duplicate: email is already a member of this group."
    }
    if ($Message -match "isn't a member|is not a member|not a member") {
        return "Email is not a member of this group."
    }
    if ($Message -match "couldn't be found|couldn't find|RecipientNotFound|doesn't exist|can't find") {
        return "Email not found in Microsoft 365 directory."
    }
    if ($Message -match "multiple recipients matching") {
        return "Ambiguous email: multiple Microsoft 365 objects share this address (e.g. a mailbox and a contact). Remove or rename the duplicate in the admin center, then retry."
    }
    return $Message
}

# Tenant context: addresses on these domains are internal Azure AD accounts;
# every other domain is represented by mail contacts.
$InternalDomainPattern = "@(consulting\.)?aswhiteglobal\.com$"

# Deterministic pick when several directory objects share one address.
# Internal-domain emails prefer real mailboxes; external-domain emails
# prefer the mail contact that represents them.
function Select-BestRecipient {
    param([object[]]$Recipients, [string]$Email)

    $isInternal = $Email -match $InternalDomainPattern
    if ($isInternal) {
        $rank = @{
            "UserMailbox"                    = 0
            "MailUser"                       = 1
            "SharedMailbox"                  = 2
            "MailContact"                    = 3
            "MailUniversalSecurityGroup"     = 4
            "MailUniversalDistributionGroup" = 5
        }
    }
    else {
        $rank = @{
            "MailContact"                    = 0
            "MailUser"                       = 1
            "UserMailbox"                    = 2
            "SharedMailbox"                  = 3
            "MailUniversalSecurityGroup"     = 4
            "MailUniversalDistributionGroup" = 5
        }
    }
    $sorted = @($Recipients | Sort-Object {
        $type = [string]$_.RecipientTypeDetails
        if ($rank.ContainsKey($type)) { $rank[$type] } else { 99 }
    })
    return $sorted[0]
}

# Exchange identity resolution is ambiguous when the same address is stamped on
# several objects (mailbox + mail contact / shared mailbox). Resolve to a single
# object GUID so the member cmdlets always target exactly one object.
function Resolve-RecipientIdentity {
    param([string]$Email)

    $escaped = $Email.Replace("'", "''")
    try {
        $recipients = @(Get-Recipient -Filter "EmailAddresses -eq 'smtp:$escaped'" -ResultSize Unlimited -ErrorAction Stop)
    }
    catch {
        return $Email
    }

    if ($recipients.Count -eq 0) {
        return $Email
    }

    $exact = @($recipients | Where-Object { [string]$_.PrimarySmtpAddress -eq $Email })
    if ($exact.Count -gt 0) {
        $recipients = $exact
    }

    $chosen = Select-BestRecipient -Recipients $recipients -Email $Email
    if ($recipients.Count -gt 1) {
        Write-Host "Warning: '$Email' matches $($recipients.Count) directory objects; using $($chosen.RecipientTypeDetails) ($($chosen.Guid))." -ForegroundColor Yellow
    }
    return $chosen.Guid.ToString()
}

function Is-SharedMailbox {
    param([string]$Identity)
    try {
        $recipient = Get-Recipient -Identity $Identity -ErrorAction Stop
        return ([string]$recipient.RecipientTypeDetails) -eq "SharedMailbox"
    }
    catch {
        return $false
    }
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

        $isSharedMailbox = Is-SharedMailbox -Identity $group

        # Pin each email to the exact object that is a member of THIS group, so
        # duplicate addresses elsewhere in the tenant cannot interfere.
        $memberGuids = @{}
        if (-not $isSharedMailbox) {
            try {
                foreach ($member in (Get-DistributionGroupMember -Identity $group -ErrorAction Stop)) {
                    $addr = ([string]$member.PrimarySmtpAddress).ToLowerInvariant()
                    if ($addr -and -not $memberGuids.ContainsKey($addr)) {
                        $memberGuids[$addr] = $member.Guid.ToString()
                    }
                }
            }
            catch {}
        }

        foreach ($email in $emails) {
            $processedCount++
            if (-not $isSharedMailbox -and $memberGuids.ContainsKey($email)) {
                $recipientIdentity = $memberGuids[$email]
            }
            else {
                $recipientIdentity = Resolve-RecipientIdentity -Email $email
            }
            try {
                if ([string]::IsNullOrWhiteSpace($recipientIdentity)) {
                    throw "There are multiple recipients matching the identity '$email'. Please specify a unique value."
                }
                if ($isSharedMailbox) {
                    if ($Action -eq "Add") {
                        Add-MailboxPermission -Identity $group -User $recipientIdentity -AccessRights FullAccess -AutoMapping $false -ErrorAction Stop | Out-Null
                    }
                    else {
                        Remove-MailboxPermission -Identity $group -User $recipientIdentity -AccessRights FullAccess -Confirm:$false -ErrorAction Stop | Out-Null
                    }
                }
                else {
                    if ($Action -eq "Add") {
                        Add-DistributionGroupMember -Identity $group -Member $recipientIdentity -BypassSecurityGroupManagerCheck -ErrorAction Stop
                    }
                    else {
                        Remove-DistributionGroupMember -Identity $group -Member $recipientIdentity -BypassSecurityGroupManagerCheck -Confirm:$false -ErrorAction Stop
                    }
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
                $message = Get-FriendlyActionError -Message $_.Exception.Message
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
            if ($isSharedMailbox) {
                $members = Get-MailboxPermission -Identity $group -ErrorAction Stop |
                    Where-Object { $_.User -notlike "NT AUTHORITY\*" -and $_.IsInherited -eq $false }
                $members | Select-Object -ExpandProperty User | Out-File -FilePath $OutputFile -Encoding UTF8
            }
            else {
                $members = Get-DistributionGroupMember -Identity $group -ErrorAction Stop
                $members | Select-Object -ExpandProperty PrimarySmtpAddress | Out-File -FilePath $OutputFile -Encoding UTF8
            }
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
