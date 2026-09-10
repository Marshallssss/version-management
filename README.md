# ConfigHub

### 当前项目与操作范围

- 顶部当前项目统一作用于机台、部署记录、配置比对、导入和机台配置统计；系统运维与用户管理仍为全局管理。
- 搜索默认只查当前项目，可明确切换为“全部项目”。打开其他项目的搜索结果时，会同步切换当前项目并打开相应机台、组件、版本、补丁或基线。
- 导入不再重复选择项目。切换项目会清除旧项目的输入和预览；原项目已经提交的记录不受影响。修改导入内容后需重新生成预览，提交成功会显示项目及导入数量。
- Viewer 不显示导入、批量录入或用户管理入口；写入接口仍执行角色和项目权限校验，导入的幂等重放也必须先通过权限检查。
- 本轮没有新增数据库 Migration。自动化入口：`node tests/integration/workspace-context-acceptance.cjs`，覆盖搜索/统计范围、跨项目跳转、迟到导入响应隔离及只读/项目权限。

### 项目录入与基线直接发布

- 项目编码支持普通空格，补丁编号支持 `.`（例如 `1.2.3`）；首尾空白仍会去除，编码仍按大小写归一化查重。
- 组件可登记并编辑负责人、型号、备注，项目克隆会保留这些资料。实验室节点分两行显示组件名称和测试版本，悬停可查看完整名称与版本。
- 创建基线时勾选父组件可选择整个分支的测试版本，部分选择显示半选状态。点击“发布 N 个测试版本并创建基线”后直接产生已发布的冻结历史快照，不再需要逐步送审和发布；原有草稿流程仍兼容。
- 直接发布仍要求基线发布权限、填写原因，不能包含已阻断版本；选中测试版本发布和快照冻结同成同败。项目标准及机台目标不会自动改变，已发布基线仍保留三分钟撤回入口及原有引用保护。
- 已发布版本可以重新进入测试，会记录状态历史、撤销不再有效的推荐，并将同组件其他测试版本标记为废弃；不会修改旧基线快照。包含返回测试版本的旧草稿不能直接发布。
- SuperAdmin 可从版本列表或已选版本摘要删除版本。已有基线、整机或 PM 历史引用的版本仍不能物理删除，以免破坏追溯。
- 本次需要数据库 Migration `20260909080639_AddComponentMetadata`，升级其他环境时先完成 Migration 再启动。

### 机台阶段与 PM 腔室

- 新建机台可填写负责人，勾选 PM1～PM6，并分别指定整机与各 PM 的阶段：Lab、MoveIn、T0、T1、T2、T3、STR、HVM。既有机台显示“未登记阶段”，不会自动猜测实际进度。
- 机台详情的“阶段与腔室 → 编辑”可更新负责人、阶段和腔室组合；“历史”可按整机或 PM 筛选变更时间、前后阶段、操作人与原因。复制机台仅复制资料、阶段和腔室组合，不复制整机事实、目标或 PM 特例。
- 每个已安装 PM 的“特例”可以选择组件及版本，独立保存该 PM 的覆盖配置；未覆盖的组件沿用整机。特例旁单独显示与本机目标基线的比较，版本匹配与安全风险互不混淆；没有显式目标时显示未指派，不借用项目标准。
- 删除特例会恢复沿用整机；移除 PM 会清除当前特例，重新加入时不会自动恢复旧特例。旧特例及腔室变更历史保留，相关版本/组件不能删除。
- 管理员可二次确认删除机台，将其从日常列表和仪表盘移除，但不销毁部署、阶段和审计历史，原序列号仍由历史机台保留。
- 本次更新包含数据库升级 `20260908155512_AddMachineEquipment`。其他环境更新代码或安装包后，先按现有升级流程执行 Migration，再启动服务；不要手工修改旧 Migration。

### 表格导入与本地 HTTP 启动

- 导入内容为两列：组件名称、版本号。可直接粘贴 Excel 两列数据（制表符分隔），也兼容逗号、连续空格或全角空格分隔；不需要手动替换为逗号。名称或版本中的单个空格保留，含逗号的 CSV 字段请用双引号包围。
- 仅配置 HTTP 地址的本地运行不会尝试 HTTPS 跳转。生产部署仍应按 Windows 部署流程使用 HTTPS；需要从 HTTP 跳转时，配置 HTTPS 监听，或将 `HttpsRedirection__HttpsPort` 设置为实际对外 HTTPS 端口（例如 `443`）。不要填写尚未部署的端口。
- 回归入口：`node tests/integration/import-parser.cjs`；安装 Playwright/Edge 并完成本地数据库配置后，可运行 `node tests/integration/startup-import-acceptance.cjs` 验证导入预览/提交、分包预算、项目集合查询及 HTTP/HTTPS 跳转（使用测试端口 5098、5099）。

面向工程团队的本地部署、局域网多用户软件配置管理与机台版本追溯系统。

当前实施状态：

- Core V1 Domain Schema 已冻结，见 `PLAN.md` 与 `docs/architecture/decision-lock.md`。
- Step 0 — Decision Lock 已完成。
- Step 1 — Windows Production Skeleton 已完成本地功能验收。
- 当前本机使用用户态 PostgreSQL 17 开发实例，Host、Migration、Worker 和后台任务已验证可用。
- **Production Integration Pending**：IIS/Windows Service、正式服务账户、TLS、DNS、Firewall、NAS 备份恢复和正式 PostgreSQL 管理仍需在目标 Windows 部署主机上完成验收；支持 Windows 11 Pro/Enterprise 或 Windows Server，计划的 PostgreSQL 18 Native Windows Service 也尚未在目标环境验证。
- Step 2 Foundation 已交付：本地 Identity/Cookie、全局角色与项目成员范围授权、Audit、Correlation、Idempotency，以及中文用户和项目成员管理界面。
- 本地身份体验已补强：登录使用用户名而非必须邮箱；密码规则为 6 位以上；Bootstrap Admin 支持本地一键启动脚本初始化和密码重置。
- Step 3 已交付：Project、Component Tree、opaque Version Sequence、独立 Lifecycle、Project Clone、中文版本详情与自动化验收。
- Step 4 至 Step 9 Core V1 已交付：不可变 Baseline、显式 Machine Target、FULL/PARTIAL Facts 投影、Drift/Risk/Compare、Trace/Search/Dashboard，以及只经 Domain Command 提交的导入。
- **Pilot Release Freeze：`0.2.0-pilot.1`**。当前功能已固定为内部试点基线；Release build（0 warning / 0 error）、真实 PostgreSQL 17 Migration、完整目录/后台任务回归、浏览器兼容、Windows 运维预检、发布 manifest（77 文件 SHA-256）和发布版 SPA health 均已通过。V1.1 新功能在试点结论前暂停。
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

## 已发布 Windows 包

仓库通过 Git LFS 提供 `artifacts/ConfigHub-release-0.1.2-win-x64.zip`。该包已包含 Host、Worker 和前端静态文件，修复旧版浏览器/WebView 缺失 `crypto.randomUUID` 时无法创建 Project 的问题，并将后台队列移入仅管理员可见的系统运维。目标机获取该包后应使用 `ops\windows\upgrade.ps1` 完成受控升级，不在目标机运行 restore 或 npm。

升级前请阅读 [Windows 一键升级手册](docs/operations/windows-upgrade.md)：其中列出了参数来源、`-WhatIf` 预演、升级阶段、备份/二进制回退边界和升级后健康检查。

## 生成 Windows EXE 发布包

ConfigHub 发布为一套 Windows 服务程序：`ConfigHub.Host.exe`、`ConfigHub.Worker.exe` 与前端静态文件一同放入可验证的 ZIP 包中。构建机运行：

```powershell
pwsh .\ops\windows\package-release.ps1 -Version 0.2.0-pilot.2
```

它会生成 `artifacts\release\<version>`、`ConfigHub-release-<version>-win-x64.zip` 和对应 SHA-256 文件。仓库还提供手动触发的 GitHub Actions 发布流程，构建、校验、上传构建产物并创建 GitHub Release；完整操作、公司内网镜像和离线自托管 Runner 的配置见 [GitHub Windows 发布](docs/operations/github-release.md)。

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
## 调测维护开关

当前调测阶段，超级管理员可在版本面板的“调测维护”中修正版本号、登记时间、发布时间和成熟度。此操作保留审计，不会自动修改已经冻结的基线快照。

数据录入完成后，在服务端配置中设置 `ConfigHub:TestDataMaintenanceEnabled=false`，重启服务即可同时关闭版本调测和基线历史维护。Windows 环境变量名为 `ConfigHub__TestDataMaintenanceEnabled`；如本机 `%LOCALAPPDATA%\ConfigHub\appsettings.local.json` 配置了同名设置，请以该文件为准。不要只隐藏前端按钮，服务端也会拒绝维护请求。

补丁：已发布记录使用“撤回补丁”，保留问题与修复内容；误录的草稿由管理员二次确认删除。机台“短期 CIP”“长期 CIP”均需填写预计恢复时间，“暂未过货”用于当前没有过货安排的机台。
