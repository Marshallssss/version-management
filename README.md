# ConfigHub

### 项目 Excel 台账与 Lab 验证

- 新下载的模板以组件为左侧行表头，每列是一套测试组合，根组件分区并冻结左侧名称与参考列。只填有变化的版本，留空沿用上一套；首次沿用生成模板时冻结的项目标准。日期按 `YYYY-MM-DD`（例如 `2026-09-18`）填写，日期与说明完整即可录入，无需提交标记；旧版横向组件模板仍兼容原“可导入”标记。
- 可以选择 Excel 后“扫描并录入”，也可由管理员设置部署电脑上的固定 `.xlsx` 路径和每日时间。Worker 执行自动扫描，浏览器不必保持打开；上传文件本身不会自动建立扫描源。重复扫描不重复登记，已导入记录修改会报冲突，不完整的新内容整批拒绝。
- 扫描结果逐项显示“组件 从旧版本变为新版本”，点击定位对应测试组合；变更组件以浅红背景展示前后版本。管理员可删除仅被 Excel 引用的误登记版本，原组合与审计保留，重扫不会复活；受基线、机台、Lab 验证或风险记录引用的版本仍受保护。已废弃版本可由管理员恢复测试，安全状态不跟随改变。
- **导入新版本只进入测试中**；已有版本引用不改变状态。同组件后续新测试版本自动废弃旧测试版本，但不会替机台升级、发布基线或改变目标。
- 实验室版本节点在“测试中”右侧显示同高的“未上机 / 已上机”深色标记，不额外增高；点击后查看整机/PM 使用与独立验证结论、打开机台、登记已完成的实际升级。已上机不等于验证通过，安装时间不是观察时间。
- **发布前强制 Lab 验证默认未开启**，保持原发布流程兼容。可通过 `ConfigHub:Laboratory:RequirePassedValidationForRelease=true` 开启；启用后发布入口统一要求本轮通过且无未解决失败，旧轮次不能冒充本轮证据。当前不提供单次豁免。
- Excel/Lab 功能依赖既有 Migration `20260917145620_ProjectMatrixImportAndLaboratoryValidation`，本轮易用性与管理员纠错无新 Migration。其他环境更新后先备份并升级数据库，再启动 Host/Worker。本机 PostgreSQL 17 已验证，Windows Production Integration Pending 不变。
- 详细填写示例、扫描权限、发布开关与验收入口见 [Excel 台账与实验室验证说明](docs/excel-matrix-laboratory.md)。

### 版本、基线与运行总览

- 左侧“版本”管理当前项目的组件、实验室测试和组件版本；“基线”独立查看整体冻结快照。实验室的“从测试版本创建基线”会打开基线页选取候选，原发布、撤回和超级维护权限不变。
- 基线历史支持按录入时间正序/倒序、日期区间、多组件具体版本筛选；多项条件须同时满足，日期按本地日历且包含结束日。组件和版本选项读取冻结快照，历史不随当前资料改名；“项目标准”标签只表示项目推荐，不会修改机台目标。
- 机台改为单行信息列表，可按位置、状态、阶段、目标基线及整机实际组件版本筛选。目标是应达到的配置，整机实际版本来自配置事实，PM 特例仍在机台详情单独查询与比较。
- 运行总览回答“当前项目有哪些配置需要关注”，点击计数可进入对应机台；同时可打开当前标准、测试版本与近期基线。它不是机台在线/产能监控；配置匹配和安全风险独立统计，空记录或读取失败不代表健康。
- 管理员的“系统运维”位于运行总览底部，展开后查看服务版本、全系统后台队列及提交连通性诊断。普通只读用户不显示运维写入入口。
- 本轮无新 Migration；PostgreSQL 17 与 Windows Production Integration Pending 验收边界不变。
- 实页截图与验收记录：[页面职责与筛选升级](docs/ui/workspace-navigation-review.md)。新增自动验收脚本 `machine-registry-acceptance.cjs`、`baseline-history-filter-acceptance.cjs`、`navigation-overview-acceptance.cjs` 位于 `tests/integration`。

### 新版 UI 已合入主干

- 2026-09-14 经用户确认，`codex/futuristic-ui` 已合入 `main`（合并提交 `55c8934`），后续在主干演进。新版浅色工作台、石墨导航、统一项目树/机台/比较和弹窗直接随主干提供；项目名称与简介集中在顶部，中文和已有业务规则保留。
- “用户与角色”先显示可筛选的用户列表，新增用户和调整角色点击后弹出；其他页面保留原有录入、权限和历史语义。
- 设计说明、实页验收与截图见 [UI 升级与验收](docs/ui/future-ui-review.md)。新增 `tests/integration/future-ui-acceptance.cjs`，覆盖真实操作、只读角色、响应式布局及截图证据。
- 启动方式不变，不需要额外 Migration。主干合并不表示 Windows Production Integration Pending 已完成。

### 废弃问题版本

- 在项目中选择组件与版本，打开“状态”页签，在“状态操作”中选择“废弃”、填写原因并点击“更新状态”。草稿、测试中、已发布、维护中的版本都可直接废弃，无需先发布；仍需原有高级工程师及项目写入权限。
- 废弃后实验室测试树自动撤下该版本，状态历史仍可查，有效推荐自动撤销。已发布基线快照及机台实际/目标不会被改写，也不会自动升级机台。
- “废弃”是成熟度，“阻断”是安全状态。致命缺陷需要在使用机台上显示严重风险时，还应设置“阻断”；两个状态可以并存，不相互替代。
- 自动验收：`tests/integration/version-deprecation-acceptance.cjs`；无需新 Migration。

### 目标与历史中的补丁

- 机台“目标与对比”按列展示目标/项目标准版本与当前实际版本；默认只看差异，取消勾选可查看全部组件及补丁记录。版本匹配和风险始终分开显示，完全匹配也可能有严重风险。
- “历史”的时间点实际配置、当前与历史比较同样支持补丁浮窗和点击跳转。补丁数量仍包含现存的草稿、已发布和已撤回记录，不是安装数量。
- 目标与项目标准使用基线冻结时的名称。历史实际由事实版本 ID 重建，名称沿用现有查询语义；旁边的补丁是当前资料，不是当时的补丁清单，也不代表当时已经安装。
- 查询和跳转不改写基线、事实或安装时间；安装时间未知时明确显示未知。旧整机对比缺少版本信息时显示“无版本记录”，不据此推断已确认缺失。Viewer 可查询时间和查看补丁，但没有写入入口或权限。
- 自动验收：`history-patches-acceptance.cjs`，覆盖两侧跳转、冻结名称、只读权限、匹配但有风险、无补丁/缺失状态以及 1366/768/390 布局。此更新不需要新 Migration。

### 删除、撤回与历史维护确认

- 删除登记版本前显示受保护引用，包括基线、整机配置、整机历史、PM 特例历史和风险快照；已删除机台的历史仍会阻止删除。没有引用时，会说明一并清理的补丁、状态与推荐记录数量。
- 版本维护、基线历史维护先显示修改内容和关联记录，确认后才保存；取消保留输入。版本维护不改冻结基线，基线历史维护会直接修正选中的历史快照，但不重写机台实际事实。未编辑的时间保留原秒数与精度。
- 已发布基线仅在发布后 3 分钟内且尚未被使用时可撤回。确认页展示阻止原因和期限；预览不写入数据，实际提交仍重新检查权限、引用与期限。
- 引用名称可打开对应机台或项目内基线历史；已删除机台只显示历史标记。读取失败时不能确认，可刷新重试。
- 调测维护受 SuperAdmin 权限和 `ConfigHub:TestDataMaintenanceEnabled` 双重保护；关闭后隐藏维护入口，接口也拒绝操作，包括关闭前成功请求的幂等重放。本次不会自动关闭你当前的维护设置。
- 自动验收：`operation-impact-acceptance.cjs`、`operation-impact-ui-acceptance.cjs`、`maintenance-closed-acceptance.cjs`。第一个脚本可加 `--expiry` 实际等待三分钟验证超时保护；不新增 Migration。
- Host/Worker 可选用环境变量 `CONFIGHUB_LOCAL_CONFIG_PATH` 指定独立配置文件。未设置时仍自动读取原本的 `%LOCALAPPDATA%\ConfigHub\appsettings.local.json`，日常启动不增加操作；显式指定的文件不存在会停止启动。关闭维护验收使用临时配置和独立端口，不改你的原配置。

### 配置中的补丁记录

- 机台当前实际树、PM 特例、配置比对和基线历史中的版本都可显示“补丁记录”标记。悬停可看最近三条及中文状态，点击进入对应版本的完整补丁页；浮窗可收起，Viewer 只读。
- 数量包含仍存在的草稿、已发布与已撤回记录，不代表机台已安装。基线旁显示的是该版本的当前补丁记录，并非当时快照；原快照名称、版本号、历史内容均不改变。
- 自动验收：`configuration-patches-acceptance.cjs`，包含机台/PM/比较/历史跳转、只读权限及桌面/手机浮窗边界。不新增数据库 Migration。

### 整机与 PM 配置比对

- “配置比对”沿用顶部当前项目，支持机台与机台、机台与已发布基线双向比较，以及基线与基线比较。结果通过“整机 / PM1 … PM6”页签切换；机台之间只比较相同编号的腔室，未安装的一侧明确标识。基线不代表腔室安装清单。
- PM 采用整机实际配置并叠加该 PM 的特例，分别显示“沿用整机 / PM 特例 / 基线快照”。清空特例恢复继承；移除再装回不会恢复旧特例。未观察到的组件显示“尚未观察”，与“已确认缺失”分开，信息不足不能判定匹配。
- 整机与各 PM 单独显示版本匹配和风险；版本一致但被阻止时仍为“匹配 + 严重风险”。“只看差异”不会清除风险提醒。PM 比较不修改整机事实、项目标准或机台目标。
- 自动验收：`pm-compare-acceptance.cjs`、`pm-compare-ui-acceptance.cjs`。不需要新增 Migration；PostgreSQL 17 / Production Integration Pending 边界不变。

### 版本登记与 PM 追溯

- 已选组件的“版本”与“补丁”页先展示已有记录，点击“登记新版本”或“登记补丁”再填写。取消后仍可在同一对象继续填写；切换组件或补丁所属版本会清理不适用的输入，提交失败不清空表单。
- 版本“影响”页单独展示当前 PM 特例、历史 PM 引用和最近记录，机台名称可直接跳转；已删除机台只保留历史标识。影响导出也包含 PM 分区，不把腔室特例混入整机当前配置或整机匹配结果。
- PM 清除特例、移除再安装、机台删除后，旧事实仍可追溯，但不再错误计为当前引用。机台/PM 与目标基线的比较采用冻结的预期名称，安全风险仍取当前状态。
- 回归入口：`project-entry-acceptance.cjs` 与 `pm-trace-acceptance.cjs`。此次没有新增 Migration；仍保留既有 PostgreSQL 17 和 Production Integration Pending 的验收边界。

### 机台详情与按需操作

- 进入机台页先显示当前项目机台列表，选择后默认查看“当前配置”；根分类与子组件沿用项目页层级，区分已确认缺失和尚未观察。
- 详情分为“当前配置、目标与对比、阶段与腔室、历史”四个页签。资料编辑、局部观察、完整配置和目标指派在弹窗中操作，不再把所有录入表单堆在详情下方。
- 新建机台和批量升级/目标集中在顶部，批量操作无需先选择单台机台；“返回机台列表”恢复列表视图。切换机台会清理旧录入选择。
- 保留原有复制资料、PM 特例、阶段历史、删除保护、目标与项目标准独立等规则。此次布局调整不需要新增 Migration。

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
