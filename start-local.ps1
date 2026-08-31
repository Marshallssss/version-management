[CmdletBinding()]
param(
    [int]$Port = 5080,
    [switch]$SkipFrontendBuild,
    [switch]$RunMigrations,
    [switch]$ResetBootstrapAdminPassword,
    [switch]$BootstrapAdminOnly,
    [string]$BootstrapAdminUserName,
    [string]$BootstrapAdminEmail,
    [string]$BootstrapAdminPassword,
    [string]$NuGetConfigFile,
    [string]$NpmRegistry
)

$ErrorActionPreference = 'Stop'

$repoRoot = $PSScriptRoot
$webRoot = Join-Path $repoRoot 'src\web'
$hostProject = Join-Path $repoRoot 'src\server\Host\ConfigHub.Host.csproj'
$url = "http://0.0.0.0:$Port"
$localConfigurationPath = Join-Path ([Environment]::GetFolderPath([Environment+SpecialFolder]::LocalApplicationData)) 'ConfigHub\appsettings.local.json'
$bundledOfflineNuGetConfig = Join-Path $repoRoot '.confighub\NuGet.Config'

function Assert-CommandAvailable {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Command,

        [Parameter(Mandatory = $true)]
        [string]$DisplayName
    )

    if (-not (Get-Command $Command -ErrorAction SilentlyContinue)) {
        throw "$DisplayName was not found. Please install it and make sure '$Command' works in a command prompt."
    }
}

function Get-LocalIPv4Address {
    $isUsableAddress = {
        param([string]$Address)

        -not [string]::IsNullOrWhiteSpace($Address) -and
        $Address -notlike '0.*' -and
        $Address -notlike '127.*' -and
        $Address -notlike '169.254.*' -and
        $Address -notlike '198.18.*' -and
        $Address -notlike '198.19.*'
    }

    $gatewayAddress = Get-NetIPConfiguration |
        Where-Object { $_.IPv4Address -and $_.IPv4DefaultGateway } |
        Sort-Object InterfaceMetric, InterfaceAlias |
        ForEach-Object { $_.IPv4Address.IPAddress } |
        Where-Object { & $isUsableAddress $_ } |
        Select-Object -First 1

    if (-not [string]::IsNullOrWhiteSpace($gatewayAddress)) {
        return $gatewayAddress
    }

    return Get-NetIPAddress -AddressFamily IPv4 |
        Where-Object {
            $_.PrefixOrigin -ne 'WellKnown' -and
            (& $isUsableAddress $_.IPAddress)
        } |
        Sort-Object InterfaceMetric, InterfaceAlias |
        Select-Object -ExpandProperty IPAddress -First 1
}

function Ensure-ConnectionString {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Name
    )

    $current = [Environment]::GetEnvironmentVariable("ConnectionStrings__$Name", 'Process')
    if ([string]::IsNullOrWhiteSpace($current)) {
        $current = [Environment]::GetEnvironmentVariable("ConnectionStrings__$Name", 'User')
    }

    if (-not [string]::IsNullOrWhiteSpace($current)) {
        [Environment]::SetEnvironmentVariable("ConnectionStrings__$Name", $current, 'Process')
        return
    }

    Write-Host ""
    Write-Host "Missing database connection string: ConnectionStrings__$Name"
    $entered = Read-Host "Enter ConnectionStrings__$Name for this run"
    if ([string]::IsNullOrWhiteSpace($entered)) {
        throw "ConnectionStrings__$Name cannot be empty."
    }

    [Environment]::SetEnvironmentVariable("ConnectionStrings__$Name", $entered, 'Process')
}

function Read-PlainTextSecret {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Prompt
    )

    $secure = Read-Host $Prompt -AsSecureString
    $buffer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try {
        return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($buffer)
    }
    finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($buffer)
    }
}

function Ensure-BootstrapAdmin {
    param(
        [string]$UserName,
        [string]$Email,
        [string]$Password
    )

    $configuredUserName = [Environment]::GetEnvironmentVariable('ConfigHub__BootstrapAdmin__UserName', 'Process')
    if ([string]::IsNullOrWhiteSpace($configuredUserName)) {
        $configuredUserName = [Environment]::GetEnvironmentVariable('ConfigHub__BootstrapAdmin__UserName', 'User')
    }
    if ([string]::IsNullOrWhiteSpace($configuredUserName)) {
        $configuredUserName = [Environment]::GetEnvironmentVariable('ConfigHub__BootstrapAdmin__Email', 'Process')
    }
    if ([string]::IsNullOrWhiteSpace($configuredUserName)) {
        $configuredUserName = [Environment]::GetEnvironmentVariable('ConfigHub__BootstrapAdmin__Email', 'User')
    }

    $configuredPassword = [Environment]::GetEnvironmentVariable('ConfigHub__BootstrapAdmin__Password', 'Process')
    if ([string]::IsNullOrWhiteSpace($configuredPassword)) {
        $configuredPassword = [Environment]::GetEnvironmentVariable('ConfigHub__BootstrapAdmin__Password', 'User')
    }

    if (([string]::IsNullOrWhiteSpace($configuredUserName) -or [string]::IsNullOrWhiteSpace($configuredPassword)) -and (Test-Path $localConfigurationPath)) {
        $localConfiguration = Get-Content $localConfigurationPath -Raw | ConvertFrom-Json
        if ([string]::IsNullOrWhiteSpace($configuredUserName)) {
            $configuredUserName = $localConfiguration.ConfigHub.BootstrapAdmin.UserName
        }
        if ([string]::IsNullOrWhiteSpace($configuredUserName)) {
            $configuredUserName = $localConfiguration.ConfigHub.BootstrapAdmin.Email
        }
        if ([string]::IsNullOrWhiteSpace($configuredPassword)) {
            $configuredPassword = $localConfiguration.ConfigHub.BootstrapAdmin.Password
        }
    }

    if ([string]::IsNullOrWhiteSpace($UserName)) {
        $UserName = $Email
    }
    if ([string]::IsNullOrWhiteSpace($UserName)) {
        $UserName = $configuredUserName
    }
    if ([string]::IsNullOrWhiteSpace($Password)) {
        $Password = $configuredPassword
    }

    if ([string]::IsNullOrWhiteSpace($UserName) -or [string]::IsNullOrWhiteSpace($Password)) {
        Write-Host ""
        Write-Host "No bootstrap admin is configured."
        Write-Host "Enter the first admin account. It will be created when the app starts."
        if ([string]::IsNullOrWhiteSpace($UserName)) {
            $UserName = Read-Host "Admin username"
        }
        if ([string]::IsNullOrWhiteSpace($Password)) {
            $Password = Read-PlainTextSecret -Prompt "Admin password, at least 6 characters"
        }
    }

    if ([string]::IsNullOrWhiteSpace($UserName)) {
        throw "Admin username cannot be empty."
    }
    if ([string]::IsNullOrWhiteSpace($Password) -or $Password.Length -lt 6) {
        throw "Admin password must be at least 6 characters."
    }

    [Environment]::SetEnvironmentVariable('ConfigHub__BootstrapAdmin__UserName', $UserName.Trim(), 'Process')
    [Environment]::SetEnvironmentVariable('ConfigHub__BootstrapAdmin__Password', $Password, 'Process')
    [Environment]::SetEnvironmentVariable('ConfigHub__BootstrapAdmin__ResetPassword', $ResetBootstrapAdminPassword.IsPresent.ToString().ToLowerInvariant(), 'Process')

    Write-Host ""
    Write-Host "Bootstrap admin username: $($UserName.Trim())"
    Write-Host "Use this username and the password you entered to sign in after startup."
}

Set-Location $repoRoot

Assert-CommandAvailable -Command 'dotnet' -DisplayName '.NET SDK'
Assert-CommandAvailable -Command 'npm' -DisplayName 'Node.js/npm'

if ([string]::IsNullOrWhiteSpace($NuGetConfigFile) -and (Test-Path $bundledOfflineNuGetConfig -PathType Leaf)) {
    $NuGetConfigFile = $bundledOfflineNuGetConfig
    Write-Host 'Detected the bundled offline NuGet source.'
}

$restoreArguments = @('restore', $hostProject)
if (-not [string]::IsNullOrWhiteSpace($NuGetConfigFile)) {
    $resolvedNuGetConfig = Resolve-Path $NuGetConfigFile -ErrorAction SilentlyContinue
    if ($null -eq $resolvedNuGetConfig) {
        throw "NuGet config file was not found: $NuGetConfigFile"
    }
    $restoreArguments += @('--configfile', $resolvedNuGetConfig.Path)
    Write-Host "Restoring .NET packages from the configured package source..."
} else {
    Write-Host "Restoring .NET packages from the default configured package sources..."
}
& dotnet @restoreArguments
if ($LASTEXITCODE -ne 0) {
    throw 'NuGet restore failed. For a strict proxy, use -NuGetConfigFile with the company mirror or a local offline source.'
}

Ensure-ConnectionString -Name 'ConfigHub'
if ($RunMigrations) {
    Ensure-ConnectionString -Name 'ConfigHubMigration'
}
Ensure-BootstrapAdmin -UserName $BootstrapAdminUserName -Email $BootstrapAdminEmail -Password $BootstrapAdminPassword

if (-not $SkipFrontendBuild) {
    Write-Host ""
    Write-Host "Installing/checking frontend dependencies..."
    $npmInstallArguments = @('--prefix', $webRoot, 'ci', '--no-audit', '--no-fund')
    if (-not [string]::IsNullOrWhiteSpace($NpmRegistry)) {
        $npmInstallArguments += "--registry=$NpmRegistry"
    }
    npm @npmInstallArguments

    Write-Host ""
    Write-Host "Building frontend..."
    npm --prefix $webRoot run build
}

if ($RunMigrations) {
    Write-Host ""
    Write-Host "Applying database migrations..."
    dotnet run --no-restore --project $hostProject -- --migrate
}

if ($BootstrapAdminOnly) {
    Write-Host ""
    Write-Host "Creating/verifying bootstrap admin..."
    dotnet run --no-restore --project $hostProject -- --bootstrap-admin-only
    return
}

$localIp = Get-LocalIPv4Address

Write-Host ""
Write-Host "ConfigHub is starting."
Write-Host "Local URL: http://localhost:$Port"
if (-not [string]::IsNullOrWhiteSpace($localIp)) {
    Write-Host "LAN URL: http://$localIp`:$Port"
} else {
    Write-Host "Could not detect the LAN IP automatically. Check your Windows IPv4 address and use http://YOUR_IP:$Port"
}
Write-Host ""
Write-Host "Keep this window open while using the app. Press Ctrl+C to stop."
Write-Host ""

dotnet run --no-restore --project $hostProject -- --urls $url
