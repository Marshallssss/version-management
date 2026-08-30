# ConfigHub

面向工程团队的本地部署、局域网多用户软件配置管理与机台版本追溯系统。

当前实施状态：

- Core V1 Domain Schema 已冻结，见 `PLAN.md` 与 `docs/architecture/decision-lock.md`。
- Step 0 — Decision Lock 已完成。
- Step 1 — Windows Production Skeleton 已完成本地功能验收。
- 当前本机使用用户态 PostgreSQL 17 开发实例，Host、Migration、Worker 和后台任务已验证可用。
- **Production Integration Pending**：IIS/Windows Service、正式服务账户、TLS、DNS、Firewall、NAS 备份恢复和正式 PostgreSQL 管理仍需在目标 Windows Server 上完成验收。
- Step 2 Foundation 已交付：本地 Identity/Cookie、全局角色与项目成员范围授权、Audit、Correlation、Idempotency，以及中文用户和项目成员管理界面。
- Step 3 已交付：Project、Component Tree、opaque Version Sequence、独立 Lifecycle、Project Clone、中文版本详情与自动化验收。
- Step 4 至 Step 9 Core V1 已交付：不可变 Baseline、显式 Machine Target、FULL/PARTIAL Facts 投影、Drift/Risk/Compare、Trace/Search/Dashboard，以及只经 Domain Command 提交的导入。
- 所有重要写入均要求 actor、reason、correlation id 和 Idempotency-Key，并写入审计事件；进入下一阶段前持续执行 Release build、真实 Migration 与集成验收。

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
dotnet build .\src\server\ConfigHub.slnx --configuration Release
npm --prefix .\src\web ci
npm --prefix .\src\web run build
dotnet run --project .\src\server\Host\ConfigHub.Host.csproj -- --migrate
dotnet run --project .\src\server\Host\ConfigHub.Host.csproj --urls http://127.0.0.1:5081
```

Do not commit connection strings. Production credentials are supplied through protected machine/service environment configuration.
