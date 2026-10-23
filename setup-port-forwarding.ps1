# ================================================================
#  PhotoWall port forwarding: phone --> VM
# ----------------------------------------------------------------
#  Phone        192.168.3.x    (WiFi LAN)
#  Host WiFi    192.168.3.26
#  VMware NAT   192.168.5.1    (VMnet8)
#  VM           192.168.5.129  (photo backend, listens on 18000)
#
#  The phone cannot reach 192.168.5.129 directly, so add a NAT
#  port forward:
#      HOST 192.168.3.26:18000 --> VM 192.168.5.129:18000
#
#  NOTE: This file is intentionally pure ASCII. Windows PowerShell
#  5.1 parses .ps1 files as ANSI (GBK on this machine), so UTF-8
#  Chinese text without BOM gets mangled and raises ParserError.
#  Keep every byte ASCII here.
#
#  Run as Administrator.
# ================================================================

$ErrorActionPreference = 'Stop'

$principal = New-Object Security.Principal.WindowsPrincipal(
    [Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Host '[ERROR] Please run this script as Administrator.' -ForegroundColor Red
    exit 1
}

$natConf  = 'C:\ProgramData\VMware\vmnetnat.conf'
$vmIp     = '192.168.5.129'
$vmPort   = 18000
$hostPort = 18000
$svc      = 'VMware NAT Service'

if (-not (Test-Path $natConf)) {
    Write-Host "[ERROR] $natConf not found - is VMware Workstation installed?" -ForegroundColor Red
    exit 1
}

# ---------- 1. backup ----------
$stamp  = Get-Date -Format 'yyyyMMdd-HHmmss'
$backup = "$natConf.bak-$stamp"
Copy-Item $natConf $backup -Force
Write-Host "[1/5] Backup created: $backup" -ForegroundColor Green

# ---------- 2. read and drop old rules with the same host port ----------
$lines = [IO.File]::ReadAllLines($natConf)
$rule  = "$hostPort = $vmIp`:$vmPort"
$hasRule = ($lines | Where-Object { $_.Trim() -eq $rule }).Count -gt 0

$portPattern = "^\s*$hostPort\s*="
$filtered = $lines | Where-Object { $_ -notmatch $portPattern }

if ($hasRule) {
    Write-Host '[2/5] Rule already present, skipping write.' -ForegroundColor Yellow
} else {
    # ---------- 3. insert at the end of the [incomingtcp] section ----------
    $out = New-Object System.Collections.Generic.List[string]
    $inIncoming = $false
    $inserted   = $false
    foreach ($line in $filtered) {
        if ($line -match '^\s*\[incomingtcp\]') { $inIncoming = $true; $out.Add($line); continue }
        if ($inIncoming -and -not $inserted -and $line -match '^\s*\[') {
            $out.Add($rule)
            $out.Add('')
            $inserted = $true
        }
        $out.Add($line)
    }
    if (-not $inserted) {
        $out.Add($rule)
    }

    # Write back as CRLF + ASCII (VMware expects this)
    $text = ($out -join "`r`n")
    [IO.File]::WriteAllText($natConf, $text + "`r`n", [Text.Encoding]::ASCII)
    Write-Host "[2/5] Rule written: $rule" -ForegroundColor Green
}

# ---------- 4. restart the NAT service ----------
Write-Host "[3/5] Restarting $svc ..." -ForegroundColor Cyan
Restart-Service -Name $svc -Force
Start-Sleep -Seconds 2
$state = (Get-Service -Name $svc).Status
Write-Host "      Service state = $state" -ForegroundColor Green
if ($state -ne 'Running') {
    Write-Host '      Service failed to start, rolling back ...' -ForegroundColor Red
    Copy-Item $backup $natConf -Force
    Restart-Service -Name $svc -Force -ErrorAction SilentlyContinue
    exit 1
}

# ---------- 5. self check ----------
Write-Host '[4/5] Checking the VM backend port ...' -ForegroundColor Cyan
try {
    $client = New-Object System.Net.Sockets.TcpClient
    $async  = $client.BeginConnect($vmIp, $vmPort, $null, $null)
    if ($async.AsyncWaitHandle.WaitOne(3000) -and $client.Connected) {
        Write-Host "      VM $vmIp`:$vmPort reachable" -ForegroundColor Green
    } else {
        Write-Host "      VM $vmIp`:$vmPort NOT reachable - check the VM is powered on and the backend is running" -ForegroundColor Yellow
    }
    $client.Close()
} catch {
    Write-Host "      VM $vmIp`:$vmPort check failed: $($_.Exception.Message)" -ForegroundColor Yellow
}

Write-Host '[5/5] Checking the forward on this host ...' -ForegroundColor Cyan
try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    $r = Invoke-WebRequest -Uri "http://127.0.0.1:$hostPort/api/health" -TimeoutSec 5 -UseBasicParsing
    Write-Host "      http://127.0.0.1:$hostPort/api/health -> $($r.StatusCode) $($r.Content)" -ForegroundColor Green
} catch {
    Write-Host "      Forward not working: $($_.Exception.Message)" -ForegroundColor Yellow
}

# ---------- tell the user what to type into the APP ----------
$wifiIp = (Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object {
        $_.InterfaceAlias -notmatch 'VMware|Loopback|Bluetooth' -and
        $_.IPAddress -notlike '169.254.*' -and
        $_.IPAddress -notlike '127.*'
    } |
    Select-Object -First 1).IPAddress

Write-Host ''
Write-Host '================ DONE ================' -ForegroundColor Green
if ($wifiIp) {
    Write-Host 'On the phone (same WiFi), open the APP, tap the gear icon' -ForegroundColor Cyan
    Write-Host 'and set the server address to:' -ForegroundColor Cyan
    Write-Host "    http://${wifiIp}:$hostPort" -ForegroundColor White
} else {
    Write-Host 'Could not auto-detect the WiFi IP. Run "ipconfig" and use your' -ForegroundColor Yellow
    Write-Host "IPv4 address with port $hostPort, e.g. http://192.168.3.26:$hostPort" -ForegroundColor White
}
Write-Host ''
Write-Host "If the 127.0.0.1 check above failed, allow port $hostPort through the firewall:" -ForegroundColor Gray
Write-Host "  netsh advfirewall firewall add rule name=`"PhotoWall`" dir=in action=allow protocol=TCP localport=$hostPort" -ForegroundColor Gray
Write-Host ''
Write-Host 'Rollback: copy' -ForegroundColor Gray
Write-Host "  $backup" -ForegroundColor Gray
Write-Host "over $natConf and restart '$svc'." -ForegroundColor Gray
