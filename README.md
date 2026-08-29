# ConfigHub

面向工程团队的本地部署、局域网多用户软件配置管理与机台版本追溯系统。

当前实施状态：

- Core V1 Domain Schema 已冻结，见 `PLAN.md` 与 `docs/architecture/decision-lock.md`。
- Step 0 — Decision Lock 已完成。
- Step 1 — Windows Production Skeleton 已完成本地功能验收。
- 当前本机使用用户态 PostgreSQL 17 开发实例，Host、Migration、Worker 和后台任务已验证可用。
- **Production Integration Pending**：IIS/Windows Service、正式服务账户、TLS、DNS、Firewall、NAS 备份恢复和正式 PostgreSQL 管理仍需在目标 Windows Server 上完成验收。
- Step 2 Foundation 与 Step 3 Project → Component → Version Vertical Slice 正在实施；Baseline、Machine 等后续能力尚未交付。
- 当前可用能力：项目创建与列表、根组件创建、版本登记及每组件递增序列号；所有写入均会记录审计事件和关联 ID。
- 仍待完成：本地用户/Cookie/RBAC、项目克隆、深层组件树和完整版本生命周期。

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
