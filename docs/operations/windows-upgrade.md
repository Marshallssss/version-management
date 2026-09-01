# Windows 一键升级手册

本手册适用于已经通过 `install.ps1` 安装的 ConfigHub Windows 部署主机。升级由 `ops\windows\upgrade.ps1` 执行：它会先校验发布包、进入维护、执行并校验静默备份、保留当前 Host/Worker 二进制副本、部署新包并运行只前进的数据库 Migration。

不要在目标服务器执行 `dotnet restore`、`dotnet publish`、`npm ci` 或 `npm run build`。目标服务器只接收已完成的发布包。

## 升级前检查

1. 使用具有本地管理员权限的账号打开 PowerShell 7.4，并确认窗口标题显示“管理员”。
2. 将发布 ZIP 完整解压到本机磁盘，例如 `C:\Staging\ConfigHub-0.2.0-pilot.1`。`-ReleasePath` 必须指向解压后的目录；该目录下应直接存在 `release-manifest.json`、`host`、`worker`。
3. 确认目标机已完成 IIS、.NET 10 Hosting Bundle、PostgreSQL 服务、Worker 服务、TLS 和 NAS 的 `preflight.ps1 -Stage PostInstall` 验收。
4. 确认运行升级脚本的身份可写入 `BackupRoot`，并拥有可读取 PostgreSQL 备份密码的 `pgpass.conf`。密码不通过参数输入。
5. 确认以下机器级环境变量已存在，且值为真实连接串：`ConnectionStrings__ConfigHub`、`ConnectionStrings__ConfigHubMigration`。前者供 Host/Worker 使用，后者仅供 `--migrate` 使用。
6. 确认 `DatabaseUser` 是备份角色，而不是应用或 Migration 角色；它需要能用 `pg_dump` 读取目标数据库。

## 参数说明

| 参数 | 是否必填 | 填写内容 |
| --- | --- | --- |
| `ReleasePath` | 是 | 解压后的发布包根目录，例如 `C:\Staging\ConfigHub-0.2.0-pilot.1`。不是 ZIP 文件，也不是 `host` 子目录。|
| `BackupRoot` | 是 | NAS 或受保护本地备份根目录，例如 `\\nas\Engineering\ConfigHub`。升级会在其中创建带 manifest 的静默备份。|
| `DatabaseHost` | 是 | PostgreSQL 主机名或 IP，例如 `localhost`、`pg-prod-01`。|
| `DatabaseName` | 是 | ConfigHub 数据库名，例如 `config_hub`。|
| `DatabaseUser` | 是 | PostgreSQL 备份账号，例如 `config_hub_backup`。密码由 `pgpass.conf` 提供。|
| `DatabasePort` | 否 | PostgreSQL 端口，默认 `5432`。|
| `PgDumpCommand` | 否 | `pg_dump.exe` 的绝对路径；未加入 PATH 时必须填写，例如 `C:\Program Files\PostgreSQL\17\bin\pg_dump.exe`。|
| `InstallRoot` | 否 | 已安装 ConfigHub 的根目录，默认 `C:\Program Files\ConfigHub`。只在首次安装时使用过自定义目录才填写。|
| `FileStoreRoot` | 否 | 已安装 ConfigHub 的文件库目录，默认 `D:\ConfigHubData\files`。|
| `SiteName`、`AppPoolName`、`WorkerServiceName` | 否 | IIS 网站、应用程序池与 Windows Worker 服务名称。只有安装时修改过默认名才填写。|

## 先预演，再执行

先用完全相同的参数加 `-WhatIf`。它会校验管理员权限、机器级连接串、发布包文件和 manifest SHA-256，但不会停止服务、复制文件、执行备份或 Migration。

```powershell
pwsh .\ops\windows\upgrade.ps1 `
  -ReleasePath C:\Staging\ConfigHub-0.2.0-pilot.1 `
  -BackupRoot \\nas\Engineering\ConfigHub `
  -DatabaseHost localhost `
  -DatabaseName config_hub `
  -DatabaseUser config_hub_backup `
  -PgDumpCommand 'C:\Program Files\PostgreSQL\17\bin\pg_dump.exe' `
  -WhatIf
```

预演输出 `Release ConfigHub <版本> passed manifest verification.` 且未报错后，移除 `-WhatIf` 执行实际升级：

```powershell
pwsh .\ops\windows\upgrade.ps1 `
  -ReleasePath C:\Staging\ConfigHub-0.2.0-pilot.1 `
  -BackupRoot \\nas\Engineering\ConfigHub `
  -DatabaseHost localhost `
  -DatabaseName config_hub `
  -DatabaseUser config_hub_backup `
  -PgDumpCommand 'C:\Program Files\PostgreSQL\17\bin\pg_dump.exe'
```

默认参数不需要写在命令中；只在实际值不同于默认值时追加，例如 `-DatabasePort 5433` 或 `-InstallRoot 'E:\Apps\ConfigHub'`。

## 脚本会做什么

实际升级会依次输出五个阶段：

1. 校验发布包的每个 manifest 文件与 SHA-256；任何缺失或篡改都会在停机前拒绝。
2. 写入 `app_offline.htm`，停止 Worker、IIS 网站和应用程序池。
3. 以 Quiesced 模式执行并校验数据库与文件库备份。
4. 将当前 Host/Worker 二进制副本保存到 `<InstallRoot>\rollback\<时间戳>`，然后镜像复制新发布包。
5. 从新 Host 执行 `--migrate`，只应用尚未执行的 Migration。

无论成功或失败，脚本都会移除维护页并尝试重新启动 IIS、应用程序池和 Worker。成功时输出新版本与二进制回退目录。

## 升级后验证与证据

脚本成功退出后立即执行：

```powershell
pwsh .\ops\windows\health-check.ps1 -BaseUri https://config-server
pwsh .\ops\windows\preflight.ps1 `
  -Stage PostInstall `
  -HostName config-server `
  -BackupRoot \\nas\Engineering\ConfigHub
```

保留以下不含秘密的信息：发布包版本、`release-manifest.json`、升级控制台输出、备份 manifest、`rollback` 目录路径、`health-check.ps1` 与 PostInstall preflight 输出。之后使用浏览器完成登录、项目读取和一个只读机台/基线查询。

## 失败与回退边界

在文件复制或 Migration 失败时，脚本会自动将 Host 与 Worker 二进制恢复到本次升级前的 `rollback` 目录。它**不会**回滚数据库 Migration；生产 Migration 必须保持 additive / expand-contract，确保旧二进制能够继续兼容已前进的数据库结构。

若脚本失败：

1. 保留控制台错误和 `rollback` 路径，不要删除备份或发布包。
2. 运行 `collect-logs.ps1` 收集 Host、Worker 和 IIS 诊断信息。
3. 执行 `health-check.ps1`，确认服务恢复状态。
4. 不要手工删除 `__EFMigrationsHistory`、手工反向执行 SQL 或将旧包覆盖后宣称数据库已回退；需要数据库恢复时按受控维护窗口使用 `restore.ps1` 和已验证备份。

## 常见问题

| 现象 | 处理 |
| --- | --- |
| `Required machine environment variable ... is not configured` | 在管理员会话中补齐机器级连接串，重开 PowerShell 后再次预演；不要把连接串写入脚本或命令历史。|
| `Release checksum mismatch` | 删除当前解压目录，从可信发布 ZIP 重新解压；不要修改发布包内容。|
| 找不到 `pg_dump` | 使用 `-PgDumpCommand` 传入 `pg_dump.exe` 的绝对路径，并确认升级账号的 `pgpass.conf` 可用。|
| Migration 失败 | 二进制会自动恢复，但数据库不会自动倒退；保留日志与备份，按受控恢复流程处理。|
| Worker 未启动 | 运行 `Get-Service ConfigHub.Worker` 和 `collect-logs.ps1`；确认服务账号仍可读取机器级连接串与写入日志目录。|
