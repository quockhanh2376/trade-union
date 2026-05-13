# This is the automation script that will add or remove emails to/from the distribution group "ASWVN_TradeUnion"
# Display big title "Zonzon's Script"
Write-Host " ______                        _                 " -ForegroundColor Green
Write-Host "|___  /                       (_)                " -ForegroundColor Green
Write-Host "   / / ___  _ __  ______ _ __  _  ___  ___       " -ForegroundColor Green
Write-Host "  / / / _ \| '_ \|_  / _ \ '_ \| |/ _ \/ __|  " -ForegroundColor Green
Write-Host " / /_| (_) | | | |/ /  __/ | | | |  __/\__ \     " -ForegroundColor Green
Write-Host "/_____\___/|_| |_/___\___|_| |_|_|\___||___/    " -ForegroundColor Green
Write-Host "               Zonzon's  S C R I P T             " -ForegroundColor Green
Write-Host "`nThis script manages emails for the distribution group ASWVN_TradeUnion" -ForegroundColor Green
Write-Host "------------------------------------------------------------------------" -ForegroundColor Green

# Step 1: Define variables
$distGroup = "ASWVN_TradeUnion@aswhiteglobal.com"  # Distribution group email
$addFilePath = "D:\OnlineProduct\TradeUnion\Add-Remove-Emails\emails.txt"         # Path to file with emails to add
$removeFilePath = "D:\OnlineProduct\TradeUnion\Add-Remove-Emails\removeemail.txt" # Path to file with emails to remove
$outputFilePath = "D:\OnlineProduct\TradeUnion\Add-Remove-Emails\final.txt"       # Path to output file

# Step 2: Check if the Exchange Online module is installed, install if missing
if (-not (Get-Module -ListAvailable -Name ExchangeOnlineManagement)) {
    Write-Host "ExchangeOnlineManagement module not found. Installing it now..." -ForegroundColor Yellow
    try {
        Install-Module -Name ExchangeOnlineManagement -Force -AllowClobber -Scope CurrentUser -ErrorAction Stop
        Write-Host "Module installed successfully." -ForegroundColor Green
    }
    catch {
        Write-Host "Failed to install ExchangeOnlineManagement module. Error: $_" -ForegroundColor Red
        exit
    }
}

# Step 3: Import the Exchange Online module
try {
    Import-Module ExchangeOnlineManagement -ErrorAction Stop
    Write-Host "Exchange Online module imported successfully." -ForegroundColor Green
}
catch {
    Write-Host "Failed to import ExchangeOnlineManagement module. Error: $_" -ForegroundColor Red
    exit
}

# Step 4: Connect to Exchange Online
Write-Host "Connecting to Exchange Online. Please sign in when prompted..." -ForegroundColor Green
try {
    Connect-ExchangeOnline -ShowBanner:$false -ErrorAction Stop
    Write-Host "Connected to Exchange Online successfully." -ForegroundColor Green
}
catch {
    Write-Host "Failed to connect to Exchange Online. Error: $_" -ForegroundColor Red
    exit
}

# Main loop to continue or stop the script
while ($true) {
    # Prompt user to choose action (Add, Remove, or Stop)
    $action = Read-Host "Enter 'A' to add emails, 'R' to remove emails, or 'S' to stop the script for $distGroup"
    $action = $action.ToUpper()

    if ($action -eq 'S') {
        Write-Host "Script stopped by user request." -ForegroundColor Yellow
        Disconnect-ExchangeOnline -Confirm:$false
        Write-Host "Disconnected from Exchange Online." -ForegroundColor Green
        exit
    }
    elseif ($action -ne 'A' -and $action -ne 'R') {
        Write-Host "Invalid choice. Please enter 'A' for add, 'R' for remove, or 'S' to stop." -ForegroundColor Red
        continue
    }

    # Display current members count before action
    Write-Host "`nCurrent members of ${distGroup}:" -ForegroundColor Green
    $currentMembers = Get-DistributionGroupMember -Identity $distGroup
    Write-Host "Total members before action: $($currentMembers.Count)" -ForegroundColor Green
    $currentMembers | 
        Select-Object -Property Name, PrimarySmtpAddress | 
        Format-Table -AutoSize

    # Step 6: Set file path and action based on user choice
    if ($action -eq 'A') {
        $filePath = $addFilePath
        $actionVerb = "Adding"
        $actionCmd = "Add-DistributionGroupMember"
    } else {
        $filePath = $removeFilePath
        $actionVerb = "Removing"
        $actionCmd = "Remove-DistributionGroupMember"
    }

    # Step 7: Verify the text file exists
    if (-not (Test-Path $filePath)) {
        Write-Host "Error: The file $filePath was not found. Please check the path and try again." -ForegroundColor Red
        continue
    }

    # Step 8: Read emails from the text file and perform the chosen action
    $emails = Get-Content $filePath -ErrorAction Stop
    $successCount = 0
    $failedCount = 0

    foreach ($email in $emails) {
        # Trim whitespace and skip empty lines
        $email = $email.Trim()
        if ([string]::IsNullOrWhiteSpace($email)) {
            continue
        }

        # Basic email format validation
        if ($email -notmatch "^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$") {
            Write-Host "Skipping $email - Invalid email format." -ForegroundColor Yellow
            $failedCount++
            continue
        }

        try {
            Write-Host "$actionVerb $email to/from $distGroup..." -ForegroundColor Green
            if ($action -eq 'A') {
                Add-DistributionGroupMember -Identity $distGroup -Member $email -ErrorAction Stop -BypassSecurityGroupManagerCheck
            } else {
                Remove-DistributionGroupMember -Identity $distGroup -Member $email -ErrorAction Stop -Confirm:$false -BypassSecurityGroupManagerCheck
            }
            $successCount++
            Start-Sleep -Milliseconds 500  # Throttle to avoid rate limiting
        }
        catch {
            Write-Host "Failed to $actionVerb $email. Error: $_" -ForegroundColor Red
            $failedCount++
        }
    }

    # Step 9: Summary of results
    Write-Host "`nProcess completed!" -ForegroundColor Green
    Write-Host "Successfully processed: $successCount emails" -ForegroundColor Green
    Write-Host "Failed to process: $failedCount emails" -ForegroundColor Red

    # Step 10: Verify the updated distribution group members (optional)
    Write-Host "`nUpdated the list members of ASW TradeUnion VietNam:" -ForegroundColor Green
    $updatedMembers = Get-DistributionGroupMember -Identity $distGroup
    $updatedMembers | 
        Select-Object -Property Name, PrimarySmtpAddress | 
        Format-Table -AutoSize
    Write-Host "`nUpdated the list members of ASW TradeUnion VietNam:" -ForegroundColor Green
    Write-Host "Total members after action: $($updatedMembers.Count)" -ForegroundColor Green

    # Export updated members to file
    $updatedEmails = $updatedMembers | Select-Object -ExpandProperty PrimarySmtpAddress
    $updatedEmails | Out-File -FilePath $outputFilePath -Encoding UTF8
    Write-Host "Updated members exported to $outputFilePath" -ForegroundColor Green

    # Ask if user wants to continue or stop
    $continue = Read-Host "Do you want to continue running the script? (Y/N)"
    $continue = $continue.ToUpper()

    if ($continue -eq 'N') {
        Disconnect-ExchangeOnline -Confirm:$false
        Write-Host "Disconnected from Exchange Online." -ForegroundColor Green
        exit
    } elseif ($continue -ne 'Y') {
        Write-Host "Invalid input. Assuming you want to continue." -ForegroundColor Yellow
    }
}

# This will never be reached due to the while loop
Disconnect-ExchangeOnline -Confirm:$false
Write-Host "Disconnected from Exchange Online." -ForegroundColor Green

#### End of script ################################################################"
