# Windows production operations

ConfigHub 的默认生产形态是纯 Windows：

```text
https://config-server/
        |
       IIS
        |
ConfigHub ASP.NET Core Application
  |-- /api/v1/*
  `-- React static files / SPA fallback

PostgreSQL Windows Service    ConfigHub Worker Windows Service
Managed File Store           NAS / Network Share Backups
```

## Prerequisites

- Windows 11 Pro/Enterprise 或 Windows Server 2022 及更高版本
- IIS with Web Server role
- .NET 10 Hosting Bundle
- PostgreSQL supported release with `pg_dump`, `pg_restore`, `createdb` and `dropdb`
- PowerShell 7.4 LTS
- A LocalMachine TLS certificate for the LAN hostname
- Separate PostgreSQL application, migration/owner and backup roles
- Protected machine environment variables named `ConnectionStrings__ConfigHub` and `ConnectionStrings__ConfigHubMigration`
- A `pgpass.conf` owned by the scheduled-task identity; backup scripts do not accept a password argument

The application and migration connection strings are never stored in these scripts or release packages. Normal Host/Worker traffic uses the application role; only the explicit `--migrate` command uses the migration role that can install `btree_gist` and change schema.

`preflight.ps1` 会自动识别 `%LOCALAPPDATA%\ConfigHub\PostgreSQL17\bin` 和常见的 Program Files 安装目录；若 PostgreSQL 位于其他位置，传入 `-PostgreSqlBinDirectory <bin目录>`。客户端工具可用不等于 PostgreSQL Windows Service 已完成验收，两项会分别报告。

## Release and initial install

Run from the repository root on a build machine:

```powershell
pwsh .\ops\windows\publish.ps1 -Version 0.1.0
```

### Restricted-proxy or offline build machines

The target server must only receive a completed release package. It must not run `dotnet restore`, `dotnet publish`, `npm ci`, or download the .NET Hosting Bundle from the public internet.

For a company package proxy, copy `ops\windows\nuget.config.example` outside the repository, replace the placeholder URL with the internal NuGet mirror, and pass it explicitly. Supply the internal npm registry in the same command:

```powershell
pwsh .\ops\windows\publish.ps1 `
  -Version 0.1.0 `
  -NuGetConfigFile C:\Build\confighub.nuget.config `
  -NpmRegistry https://npm.company.example/
```

For an isolated build machine whose NuGet cache was pre-warmed for the release Runtime (normally `win-x64`) and whose `src\web\node_modules` came from approved internal sources, build the SPA once, then package without any restore or frontend download:

```powershell
dotnet restore .\src\server\ConfigHub.slnx --runtime win-x64
npm --prefix .\src\web run build
pwsh .\ops\windows\publish.ps1 -Version 0.1.0 -SkipRestore -SkipFrontendBuild
```

Obtain the .NET 10 Hosting Bundle for the target server through the approved internal software distribution channel. Keep proxy credentials in the CI/build-agent credential store or the approved NuGet/npm configuration location, never in this repository or release package.

Copy `artifacts\release\0.1.0` to the server, then run elevated:

```powershell
pwsh .\ops\windows\install.ps1 `
  -PackageRoot C:\Staging\ConfigHub-0.1.0 `
  -HostName config-server `
  -CertificateThumbprint '<thumbprint>'
```

The installer creates one IIS Site/Application Pool and one Windows Worker service. It does not install prerequisites, create certificates, create database users or manufacture secrets.

## Target server preflight

Before installation, run the read-only preflight in an elevated PowerShell session. It records no secrets and does not alter IIS, services, PostgreSQL, certificates or the backup path.

```powershell
pwsh .\ops\windows\preflight.ps1 `
  -Stage PreInstall `
  -HostName config-server `
  -CertificateThumbprint '<thumbprint>' `
  -BackupRoot \\nas\Engineering\ConfigHub
```

After installation, run the same command with `-Stage PostInstall` to additionally check the Worker service and HTTPS readiness endpoint. The script emits structured check objects, so the result can be retained with `| ConvertTo-Json` or `| Export-Csv`. Use `-ReportOnly` only when collecting an incomplete environment report; a normal preflight exits nonzero on any failed check.

## Nightly online backup

Nightly backup does not stop IIS, API or Worker. Attachments are immutable and committed after their final file name exists, so a database-first dump plus file-store copy is recoverable as one manifest set.

```powershell
pwsh .\ops\windows\backup.ps1 `
  -BackupRoot \\nas\Engineering\ConfigHub `
  -FileStoreRoot D:\ConfigHubData\files `
  -DatabaseHost localhost `
  -DatabaseName config_hub `
  -DatabaseUser config_hub_backup
```

Schedule this under a least-privilege service identity with NAS write permission and a protected PostgreSQL password file.

## Upgrade / maintenance backup

`upgrade.ps1` creates `app_offline.htm`, stops Worker, runs the same backup engine in a quiesced state, verifies it, applies the release and runs migrations. Normal nightly backup never creates this maintenance window.

```powershell
pwsh .\ops\windows\upgrade.ps1 `
  -ReleasePath C:\Staging\ConfigHub-0.2.0 `
  -BackupRoot \\nas\Engineering\ConfigHub `
  -DatabaseHost localhost `
  -DatabaseName config_hub `
  -DatabaseUser config_hub_backup
```

## Routine commands

```powershell
pwsh .\ops\windows\start.ps1
pwsh .\ops\windows\stop.ps1
pwsh .\ops\windows\health-check.ps1 -BaseUri https://config-server
pwsh .\ops\windows\collect-logs.ps1 -OutputPath C:\Support\ConfigHub-diagnostics.zip
```

All production migrations must be additive/expand-contract. A binary rollback cannot safely reverse an arbitrary destructive database migration.
