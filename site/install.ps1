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
