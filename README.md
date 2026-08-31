# ConfigHub

面向工程团队的本地部署、局域网多用户软件配置管理与机台版本追溯系统。

当前实施状态：

- Core V1 Domain Schema 已冻结，见 `PLAN.md` 与 `docs/architecture/decision-lock.md`。
- Step 0 — Decision Lock 已完成。
- Step 1 — Windows Production Skeleton 已完成本地功能验收。
- 当前本机使用用户态 PostgreSQL 17 开发实例，Host、Migration、Worker 和后台任务已验证可用。
- **Production Integration Pending**：IIS/Windows Service、正式服务账户、TLS、DNS、Firewall、NAS 备份恢复和正式 PostgreSQL 管理仍需在目标 Windows Server 上完成验收；计划的 PostgreSQL 18 Native Windows Service 也尚未在目标环境验证。
- Step 2 Foundation 已交付：本地 Identity/Cookie、全局角色与项目成员范围授权、Audit、Correlation、Idempotency，以及中文用户和项目成员管理界面。
- 本地身份体验已补强：登录使用用户名而非必须邮箱；密码规则为 6 位以上；Bootstrap Admin 支持本地一键启动脚本初始化和密码重置。
- Step 3 已交付：Project、Component Tree、opaque Version Sequence、独立 Lifecycle、Project Clone、中文版本详情与自动化验收。
- Step 4 至 Step 9 Core V1 已交付：不可变 Baseline、显式 Machine Target、FULL/PARTIAL Facts 投影、Drift/Risk/Compare、Trace/Search/Dashboard，以及只经 Domain Command 提交的导入。
- 所有重要写入均要求 actor、reason、correlation id 和 Idempotency-Key，并写入审计事件；进入下一阶段前持续执行 Release build、真实 Migration 与集成验收。
- Step 11 试点执行单见 `docs/operations/internal-pilot.md`；它在生产集成通过后引导真实 Project、20–50 台 Machine、现有版本清单和工程师验收。

## Repository layout

```text
docs/                 Architecture decisions
ops/windows/          Windows publish, install and operations scripts
src/server/Host/      Single IIS ASP.NET Core host + SPA
src/server/Worker/    Windows background worker
src/server/Infrastructure/ PostgreSQL persistence and migrations
src/web/              React + TypeScript UI
```

## Local run and verification

Prerequisites: .NET 10 SDK and Node.js 24.

推荐本地运行方式是在仓库根目录双击：

```text
start-local.cmd
```

脚本会：

- 读取本机 `%LOCALAPPDATA%\ConfigHub\appsettings.local.json` 或用户环境变量中的数据库连接串。
- 在首次缺少管理员配置时提示输入 Bootstrap 管理员用户名和密码。
- 构建 React 前端到 `src/server/Host/wwwroot`。
- 以 `http://0.0.0.0:5080` 启动 ASP.NET Core Host，并打印本机和局域网访问地址。

常用脚本参数：

```powershell
.\start-local.cmd -SkipFrontendBuild
.\start-local.cmd -RunMigrations
.\start-local.cmd -Port 5090
.\start-local.cmd -BootstrapAdminUserName admin -BootstrapAdminPassword 123456 -ResetBootstrapAdminPassword
```

## 严格代理或离线本地运行

默认的 `dotnet restore` 会使用当前 NuGet 配置；若公司代理拦截 `api.nuget.org`，请使用公司 NuGet 镜像，或从已成功还原的构建机导出离线包源。离线源和 `NuGet.Config` 位于 `.confighub`，不会提交到 Git。仓库同时通过 Git LFS 发布 `artifacts/ConfigHub-offline-nuget-win-x64-*.zip`，方便严格内网直接取得已验证的离线依赖包。

在具备已还原 NuGet 缓存的构建机执行：

```powershell
.\ops\windows\export-offline-nuget-source.ps1 -Runtime win-x64
```

从 GitHub 克隆时请先拉取 LFS 文件并解压该离线包到项目根目录：

```powershell
git lfs pull
Expand-Archive .\artifacts\ConfigHub-offline-nuget-win-x64-*.zip -DestinationPath . -Force
```

也可以将构建机生成的 `.confighub` 目录连同源码复制到受限机器。完成后，本地启动使用：

```powershell
.\start-local.ps1 -NuGetConfigFile .\.confighub\NuGet.Config
```

仓库根目录的 `NuGet.Config` 默认指向 `.confighub\offline-nuget`，因此解压完成后直接执行 `dotnet restore`、`dotnet build`、`dotnet run`、`start-local.cmd` 或 `.\start-local.ps1` 都会使用离线源，无需增加参数；显式 `-NuGetConfigFile` 仍可用于指定公司镜像或其他位置的配置。

本地启动优先读取 `%LOCALAPPDATA%\ConfigHub\appsettings.local.json` 中的连接串；首次输入真实 PostgreSQL 连接串后会自动保存到该文件，后续启动无需重复输入。`$env:ConnectionStrings__ConfigHub`、`你的密码` 和 `...` 都是示例或变量文本，不能作为实际连接串值；脚本会拒绝这些无效值，不会再将其传给 Npgsql。

公司镜像也可以直接作为 `-NuGetConfigFile` 传入；前端若同样受限，附加 `-NpmRegistry https://npm.company.example/`，或带上已构建的 `src\server\Host\wwwroot` 并使用 `-SkipFrontendBuild`。

手工验证命令：

```powershell
$env:ConnectionStrings__ConfigHub = 'Host=localhost;Database=config_hub;Username=config_hub_app;Password=...'
$env:ConnectionStrings__ConfigHubMigration = 'Host=localhost;Database=config_hub;Username=config_hub_migrator;Password=...'
$env:ConfigHub__BootstrapAdmin__UserName = 'admin'
$env:ConfigHub__BootstrapAdmin__Password = '123456'
dotnet build .\src\server\ConfigHub.slnx --configuration Release
npm --prefix .\src\web ci
npm --prefix .\src\web run build
dotnet run --project .\src\server\Host\ConfigHub.Host.csproj -- --migrate
dotnet run --project .\src\server\Host\ConfigHub.Host.csproj -- --urls http://0.0.0.0:5080
```

Do not commit connection strings. Production credentials are supplied through protected machine/service environment configuration.
