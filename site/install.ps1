$ErrorActionPreference = 'Stop'

if ($env:OS -ne 'Windows_NT') {
    throw 'Koda installer supports Windows only.'
}

[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

function Write-KodaStep {
    param([string]$Message)
    Write-Host "[koda] $Message" -ForegroundColor DarkYellow
}

function Update-KodaProcessPath {
    $kodaMachinePath = [Environment]::GetEnvironmentVariable('Path', 'Machine')
    $kodaUserPath = [Environment]::GetEnvironmentVariable('Path', 'User')
    $env:Path = @($kodaMachinePath, $kodaUserPath) -join ';'
}

function Install-KodaDependency {
    param(
        [string]$Id,
        [string]$Name
    )

    if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
        throw "$Name is required, but winget is unavailable. Install App Installer from Microsoft Store and run this command again."
    }

    Write-KodaStep "Installing $Name..."
    & winget install --id $Id --exact --source winget --accept-package-agreements --accept-source-agreements --silent
    if ($LASTEXITCODE -ne 0) {
        throw "winget could not install $Name (exit code $LASTEXITCODE)."
    }
    Update-KodaProcessPath
}

function Invoke-KodaOptionalZeroTierSetup {
    $kodaZeroTierNetworkId = '2873fd00f2d90943'
    $kodaZeroTierPort = 25565

    Write-Host ''
    Write-Host 'Optional: Koda can also set up ZeroTier for a Minecraft server network.' -ForegroundColor DarkYellow
    Write-Host "This installs ZeroTier, joins network $kodaZeroTierNetworkId, and opens TCP/UDP port $kodaZeroTierPort."
    $kodaZeroTierAnswer = Read-Host 'Set this up now? [y/N]'
    if ($kodaZeroTierAnswer -notin @('y', 'Y', 'yes', 'YES', 'Yes')) {
        Write-KodaStep 'Skipping ZeroTier setup.'
        return
    }

    $kodaZeroTierScript = @'
#Requires -Version 5.1
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$kodaZeroTierNetworkId = '2873fd00f2d90943'
$kodaZeroTierPort = 25565

function Write-KodaZeroTierStep {
    param([string]$Message)
    Write-Host "[koda zerotier] $Message" -ForegroundColor DarkYellow
}

$kodaIsAdmin = (
    New-Object Security.Principal.WindowsPrincipal(
        [Security.Principal.WindowsIdentity]::GetCurrent()
    )
).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator
)

if (-not $kodaIsAdmin) {
    throw 'ZeroTier setup must run as administrator.'
}

Write-KodaZeroTierStep 'Checking ZeroTier...'
$kodaZeroTierService = Get-Service -Name 'ZeroTierOneService' -ErrorAction SilentlyContinue

if (-not $kodaZeroTierService) {
    Write-KodaZeroTierStep 'Downloading ZeroTier...'
    $kodaZeroTierInstaller = Join-Path ([IO.Path]::GetTempPath()) 'Koda-ZeroTier-One.msi'
    try {
        Invoke-WebRequest -Uri 'https://download.zerotier.com/dist/ZeroTier%20One.msi' -OutFile $kodaZeroTierInstaller -UseBasicParsing
        Write-KodaZeroTierStep 'Installing ZeroTier...'
        $kodaZeroTierInstallProcess = Start-Process -FilePath 'msiexec.exe' -ArgumentList "/i `"$kodaZeroTierInstaller`" /qn /norestart" -Wait -PassThru -WindowStyle Hidden
    } finally {
        Remove-Item -LiteralPath $kodaZeroTierInstaller -Force -ErrorAction SilentlyContinue
    }

    if ($kodaZeroTierInstallProcess.ExitCode -notin @(0, 3010)) {
        throw "ZeroTier installer failed with exit code $($kodaZeroTierInstallProcess.ExitCode)."
    }
} else {
    Write-KodaZeroTierStep 'ZeroTier is already installed.'
}

Write-KodaZeroTierStep 'Configuring ZeroTier service...'
Set-Service -Name 'ZeroTierOneService' -StartupType Automatic
$kodaZeroTierService = Get-Service -Name 'ZeroTierOneService' -ErrorAction Stop
if ($kodaZeroTierService.Status -ne 'Running') {
    Start-Service -Name 'ZeroTierOneService'
}

$kodaZeroTierTimeout = 30
while ($kodaZeroTierTimeout -gt 0) {
    $kodaZeroTierService = Get-Service -Name 'ZeroTierOneService' -ErrorAction SilentlyContinue
    if ($kodaZeroTierService.Status -eq 'Running') {
        break
    }
    Start-Sleep -Seconds 1
    $kodaZeroTierTimeout--
}

if ($kodaZeroTierService.Status -ne 'Running') {
    throw 'ZeroTier service did not start.'
}

Write-KodaZeroTierStep 'Finding ZeroTier CLI...'
$kodaZeroTierCliPaths = @(
    "${env:ProgramFiles(x86)}\ZeroTier\One\zerotier-cli.bat",
    "${env:ProgramFiles}\ZeroTier\One\zerotier-cli.bat",
    "${env:ProgramFiles(x86)}\ZeroTier\One\zerotier-cli.exe",
    "${env:ProgramFiles}\ZeroTier\One\zerotier-cli.exe"
)

$kodaZeroTierCli = $kodaZeroTierCliPaths |
    Where-Object { $_ -and (Test-Path -LiteralPath $_) } |
    Select-Object -First 1

if (-not $kodaZeroTierCli) {
    throw 'zerotier-cli was not found.'
}

Write-KodaZeroTierStep "Joining network $kodaZeroTierNetworkId..."
& $kodaZeroTierCli join $kodaZeroTierNetworkId
if ($LASTEXITCODE -ne 0) {
    throw "zerotier-cli join failed with exit code $LASTEXITCODE."
}

Start-Sleep -Seconds 5

$kodaZeroTierAdapter = Get-NetAdapter -ErrorAction SilentlyContinue |
    Where-Object {
        $_.InterfaceDescription -match 'ZeroTier' -or
        $_.Name -match 'ZeroTier'
    } |
    Select-Object -First 1

Write-KodaZeroTierStep "Opening TCP/UDP port $kodaZeroTierPort..."
$kodaZeroTierRuleNames = @(
    "ZeroTier Minecraft TCP $kodaZeroTierPort",
    "ZeroTier Minecraft UDP $kodaZeroTierPort"
)

foreach ($kodaZeroTierRuleName in $kodaZeroTierRuleNames) {
    Get-NetFirewallRule -DisplayName $kodaZeroTierRuleName -ErrorAction SilentlyContinue |
        Remove-NetFirewallRule -ErrorAction SilentlyContinue
}

if ($kodaZeroTierAdapter) {
    New-NetFirewallRule -DisplayName "ZeroTier Minecraft TCP $kodaZeroTierPort" -Direction Inbound -Protocol TCP -LocalPort $kodaZeroTierPort -InterfaceAlias $kodaZeroTierAdapter.Name -Action Allow -Profile Any | Out-Null
    New-NetFirewallRule -DisplayName "ZeroTier Minecraft UDP $kodaZeroTierPort" -Direction Inbound -Protocol UDP -LocalPort $kodaZeroTierPort -InterfaceAlias $kodaZeroTierAdapter.Name -Action Allow -Profile Any | Out-Null
} else {
    New-NetFirewallRule -DisplayName "ZeroTier Minecraft TCP $kodaZeroTierPort" -Direction Inbound -Protocol TCP -LocalPort $kodaZeroTierPort -Action Allow -Profile Any | Out-Null
    New-NetFirewallRule -DisplayName "ZeroTier Minecraft UDP $kodaZeroTierPort" -Direction Inbound -Protocol UDP -LocalPort $kodaZeroTierPort -Action Allow -Profile Any | Out-Null
}

Write-Host ''
Write-Host 'ZeroTier setup complete.' -ForegroundColor Green
Write-Host "Network ID: $kodaZeroTierNetworkId"
Write-Host ''
Write-Host 'ZeroTier status:'
& $kodaZeroTierCli status
Write-Host ''
Write-Host 'ZeroTier networks:'
& $kodaZeroTierCli listnetworks

Start-Sleep -Seconds 2
$kodaZeroTierAdapter = Get-NetAdapter -ErrorAction SilentlyContinue |
    Where-Object {
        $_.InterfaceDescription -match 'ZeroTier' -or
        $_.Name -match 'ZeroTier'
    } |
    Select-Object -First 1

if ($kodaZeroTierAdapter) {
    $kodaZeroTierAddress = Get-NetIPAddress -InterfaceIndex $kodaZeroTierAdapter.ifIndex -AddressFamily IPv4 -ErrorAction SilentlyContinue |
        Where-Object { $_.IPAddress -notmatch '^169\.254\.' } |
        Select-Object -First 1

    if ($kodaZeroTierAddress) {
        Write-Host ''
        Write-Host "ZeroTier IP: $($kodaZeroTierAddress.IPAddress)"
        Write-Host "Minecraft address: $($kodaZeroTierAddress.IPAddress):$kodaZeroTierPort"
    } else {
        Write-Host ''
        Write-Host 'ZeroTier IP is not assigned yet. The device may need authorization in ZeroTier Central.'
    }
}

$kodaMinecraftListening = Get-NetTCPConnection -State Listen -LocalPort $kodaZeroTierPort -ErrorAction SilentlyContinue
if ($kodaMinecraftListening) {
    Write-Host ''
    Write-Host "Minecraft/server: TCP $kodaZeroTierPort LISTENING"
} else {
    Write-Host ''
    Write-Host "Port $kodaZeroTierPort is allowed in Firewall, but no program is listening on it yet."
    Write-Host 'Start the Minecraft server first.'
}
'@

    $kodaZeroTierTempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
    $kodaZeroTierScriptPath = Join-Path $kodaZeroTierTempRoot ("koda-zerotier-" + [IO.Path]::GetRandomFileName() + '.ps1')
    Set-Content -LiteralPath $kodaZeroTierScriptPath -Value $kodaZeroTierScript -Encoding UTF8

    try {
        $kodaElevatedPowerShell = (Get-Command powershell.exe -ErrorAction Stop).Source
        Write-KodaStep 'Starting ZeroTier setup as administrator...'
        $kodaZeroTierProcess = Start-Process -FilePath $kodaElevatedPowerShell -Verb RunAs -Wait -PassThru -ArgumentList @(
            '-NoProfile',
            '-ExecutionPolicy', 'RemoteSigned',
            '-File', "`"$kodaZeroTierScriptPath`""
        )
        if ($null -ne $kodaZeroTierProcess.ExitCode -and $kodaZeroTierProcess.ExitCode -ne 0) {
            throw "ZeroTier setup failed or was cancelled (exit code $($kodaZeroTierProcess.ExitCode))."
        }
    } finally {
        $kodaResolvedZeroTierScriptPath = [IO.Path]::GetFullPath($kodaZeroTierScriptPath)
        if ($kodaResolvedZeroTierScriptPath.StartsWith($kodaZeroTierTempRoot, [StringComparison]::OrdinalIgnoreCase) -and
            (Split-Path -Leaf $kodaResolvedZeroTierScriptPath).StartsWith('koda-zerotier-')) {
            Remove-Item -LiteralPath $kodaResolvedZeroTierScriptPath -Force -ErrorAction SilentlyContinue
        }
    }
}

Write-KodaStep 'Checking requirements...'

if (-not (Get-Command node.exe -ErrorAction SilentlyContinue) -or -not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) {
    Install-KodaDependency -Id 'OpenJS.NodeJS.LTS' -Name 'Node.js LTS'
}

$kodaNodeCommand = (Get-Command node.exe -ErrorAction Stop).Source
$kodaNpmCommand = (Get-Command npm.cmd -ErrorAction Stop).Source
$kodaNodeMajor = [int]((& $kodaNodeCommand --version).TrimStart('v').Split('.')[0])
if ($kodaNodeMajor -lt 20) {
    Install-KodaDependency -Id 'OpenJS.NodeJS.LTS' -Name 'Node.js LTS'
    $kodaNodeCommand = (Get-Command node.exe -ErrorAction Stop).Source
    $kodaNpmCommand = (Get-Command npm.cmd -ErrorAction Stop).Source
    $kodaNodeMajor = [int]((& $kodaNodeCommand --version).TrimStart('v').Split('.')[0])
    if ($kodaNodeMajor -lt 20) {
        throw 'Koda requires Node.js 20 or newer. Restart PowerShell and run the installer again.'
    }
}

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    Install-KodaDependency -Id 'Git.Git' -Name 'Git'
}

Write-KodaStep 'Installing the latest Koda CLI...'
$kodaTempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
$kodaInstallRoot = Join-Path $kodaTempRoot ("koda-install-" + [IO.Path]::GetRandomFileName())
$kodaSourceRoot = Join-Path $kodaInstallRoot 'source'
New-Item -ItemType Directory -Path $kodaInstallRoot | Out-Null

try {
    & git clone --depth 1 --quiet 'https://github.com/Lafmine/kodacli.git' $kodaSourceRoot
    if ($LASTEXITCODE -ne 0) {
        throw "Git could not download Koda CLI (exit code $LASTEXITCODE)."
    }

    Push-Location $kodaSourceRoot
    try {
        & $kodaNpmCommand install --no-audit --no-fund
        if ($LASTEXITCODE -ne 0) {
            throw "npm could not prepare Koda CLI (exit code $LASTEXITCODE)."
        }

        & $kodaNpmCommand run build
        if ($LASTEXITCODE -ne 0) {
            throw "npm could not build Koda CLI (exit code $LASTEXITCODE)."
        }

        $kodaPackageName = (& $kodaNpmCommand pack --ignore-scripts --silent).Trim().Split([Environment]::NewLine)[-1]
        if ($LASTEXITCODE -ne 0 -or -not $kodaPackageName) {
            throw "npm could not package Koda CLI (exit code $LASTEXITCODE)."
        }

        $kodaPackagePath = Join-Path $kodaSourceRoot $kodaPackageName
        & $kodaNpmCommand install --global $kodaPackagePath --ignore-scripts
        if ($LASTEXITCODE -ne 0) {
            throw "npm could not install Koda CLI (exit code $LASTEXITCODE)."
        }
    } finally {
        Pop-Location
    }
} finally {
    $kodaResolvedInstallRoot = [IO.Path]::GetFullPath($kodaInstallRoot)
    if ($kodaResolvedInstallRoot.StartsWith($kodaTempRoot, [StringComparison]::OrdinalIgnoreCase) -and
        (Split-Path -Leaf $kodaResolvedInstallRoot).StartsWith('koda-install-')) {
        Remove-Item -LiteralPath $kodaResolvedInstallRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
}

$kodaNpmPrefix = (& $kodaNpmCommand prefix --global).Trim()
if (-not $kodaNpmPrefix) {
    throw 'Could not determine the global npm directory.'
}

$kodaUserPath = [Environment]::GetEnvironmentVariable('Path', 'User')
$kodaUserEntries = @($kodaUserPath -split ';' | Where-Object { $_ })
if ($kodaNpmPrefix -notin $kodaUserEntries) {
    $kodaUpdatedUserPath = (@($kodaUserEntries) + $kodaNpmPrefix) -join ';'
    [Environment]::SetEnvironmentVariable('Path', $kodaUpdatedUserPath, 'User')
}

if ($kodaNpmPrefix -notin @($env:Path -split ';')) {
    $env:Path = "$env:Path;$kodaNpmPrefix"
}

$kodaBlockedShimPath = Join-Path $kodaNpmPrefix 'koda.ps1'
if (Test-Path -LiteralPath $kodaBlockedShimPath) {
    Remove-Item -LiteralPath $kodaBlockedShimPath -Force
}

$kodaCommandPath = Join-Path $kodaNpmPrefix 'koda.cmd'
if (Test-Path -LiteralPath $kodaCommandPath) {
    $kodaVersion = (& $kodaCommandPath --version).Trim()
} else {
    throw 'Koda was installed, but its command could not be found. Restart PowerShell and run koda.'
}

$kodaWindowsPowerShell = (Get-Command powershell.exe -ErrorAction Stop).Source
$kodaRestrictedVersion = (& $kodaWindowsPowerShell -NoProfile -ExecutionPolicy Restricted -Command 'koda --version').Trim()
if ($LASTEXITCODE -ne 0 -or $kodaRestrictedVersion -ne $kodaVersion) {
    throw 'Koda was installed, but the command failed its restricted PowerShell check.'
}

Write-Host ''
Write-Host "Koda CLI $kodaVersion installed successfully." -ForegroundColor Green
Write-Host 'Open a project folder and run: koda'

Invoke-KodaOptionalZeroTierSetup
