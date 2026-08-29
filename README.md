# ConfigHub

面向工程团队的本地部署、局域网多用户软件配置管理与机台版本追溯系统。

当前实施状态：

- Core V1 Domain Schema 已冻结，见 `PLAN.md` 与 `docs/architecture/decision-lock.md`。
- Step 0 — Decision Lock 已完成。
- Step 1 — Windows Production Skeleton 已建立。
- Project、Baseline、Machine 等业务能力尚未开始实现，将按 Vertical Slice 逐段交付。

## Repository layout

```text
docs/                 Architecture decisions
ops/windows/          Windows publish, install and operations scripts
src/server/Host/      Single IIS ASP.NET Core host + SPA
src/server/Worker/    Windows background worker
src/server/Infrastructure/ PostgreSQL persistence and migrations
src/web/              React + TypeScript UI
```

## Local verification

Prerequisites: .NET 10 SDK and Node.js 24.

```powershell
$env:ConnectionStrings__ConfigHub = 'Host=localhost;Database=config_hub;Username=config_hub_app;Password=...'
$env:ConnectionStrings__ConfigHubMigration = 'Host=localhost;Database=config_hub;Username=config_hub_migrator;Password=...'
dotnet build .\src\server\ConfigHub.slnx
npm --prefix .\src\web ci
npm --prefix .\src\web run build
dotnet run --project .\src\server\Host\ConfigHub.Host.csproj
```

Do not commit connection strings. Production credentials are supplied through protected machine/service environment configuration.
