# GitHub Windows Release

ConfigHub 是 Windows Web/Worker 系统，发布结果是一份可部署 ZIP，而非单一桌面 EXE。每一份发布包都包含：

- `host/ConfigHub.Host.exe`：IIS 中运行的网站与 API。
- `worker/ConfigHub.Worker.exe`：Windows 后台服务。
- `release-manifest.json`：已发布文件的逐个 SHA-256 清单。
- `ConfigHub-release-<version>-win-x64.zip.sha256`：整个 ZIP 的 SHA-256 校验值。

## 本机构建

在已配置公司包源或已解压离线 NuGet 包的 Windows 构建机运行：

```powershell
pwsh .\ops\windows\package-release.ps1 -Version 0.2.0-pilot.2
```

严格离线构建机必须已针对 `win-x64` 运行过 restore，且已构建 SPA，才可使用：

```powershell
pwsh .\ops\windows\package-release.ps1 `
  -Version 0.2.0-pilot.2 `
  -SkipRestore `
  -SkipFrontendBuild
```

脚本会拒绝覆盖同版本 ZIP；先产生 Host/Worker EXE，再校验 release manifest 中每个文件的 SHA-256，最后校验 ZIP 内容与 manifest 一致。产物位于：

```text
artifacts\release\0.2.0-pilot.2\
artifacts\ConfigHub-release-0.2.0-pilot.2-win-x64.zip
artifacts\ConfigHub-release-0.2.0-pilot.2-win-x64.zip.sha256
```

目标服务器应完整解压 ZIP，并将解压目录作为 `upgrade.ps1 -ReleasePath` 的参数。不要在目标服务器运行 restore、npm 或 publish。

## GitHub Actions 发布

仓库中的 `.github/workflows/release.yml` 仅支持手动触发，避免普通 `main` 提交被误发布：

1. 在 GitHub 的 **Actions** 中打开 **Windows Release**，选择 **Run workflow**。
2. 输入版本号，例如 `0.2.0-pilot.2`。
3. 试点包保留“预发布”勾选；正式版本取消勾选。
4. 工作流完成后，从对应 GitHub Release 下载 ZIP 和 `.sha256`，或从该次工作流的构建产物下载同一份文件。

默认 GitHub Windows Runner 使用 NuGet.org 与 npm 公共源。若构建依赖公司镜像，可在仓库 **Settings → Secrets and variables → Actions → Variables** 配置：

- `CONFIGHUB_NUGET_SOURCE`：公司 NuGet V3 源地址。
- `CONFIGHUB_NPM_REGISTRY`：公司 npm registry 地址。
- `CONFIGHUB_NUGET_USERNAME`：NuGet 源的令牌用户名；未设置时使用 `token`。

需要令牌的源可设置 `NUGET_AUTH_TOKEN`、`NPM_TOKEN` Secret；令牌和连接串不得写入仓库、发布包、manifest 或 Release Notes。

对于无法访问公网或公司内网源的环境，应在公司网络内使用 Windows 自托管 Runner。该 Runner 先按既有离线流程预热 `win-x64` NuGet 资产并构建 SPA，然后触发工作流时将构建环境选为 `self-hosted`，并勾选“使用预热的离线依赖”。该模式只打包和校验，避免工作流在错误网络条件下尝试联网。

GitHub Release 使用 `v<version>` 标签，自动附加 ZIP、ZIP 校验文件和自动生成的合并说明。不得重用已经发布的版本号；修复请发布新版本，例如 `0.2.0-pilot.3`。
