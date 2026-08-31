# Step 11 内部试点执行单

本执行单用于 Core V1 在目标 Windows Server 完成生产集成验收后开展首个内部试点。试点不替代 Production Integration Pending 的 IIS、Worker、TLS、DNS、Firewall、PostgreSQL Service 和 NAS 恢复验收；这些前提必须先通过 `ops/windows/preflight.ps1 -Stage PostInstall`。

## 试点边界

- 一个真实 Project。
- 20 至 50 台真实 Machine。
- 一份脱敏后的现有 Excel/CSV 版本清单。
- 一位业务验收负责人、一位 SeniorEngineer、一位普通 Engineer 和一位 Viewer。
- 不导入生产秘密、个人资料或未脱敏的客户数据。

## 启动前清单

1. 在目标服务器执行 `ops/windows/preflight.ps1 -Stage PostInstall`，保存其 JSON 或 CSV 输出；所有检查必须为 `Pass`。
2. 运行 `ops/windows/health-check.ps1 -BaseUri https://<服务器域名>`，确认 Host、数据库与 Worker 健康。
3. 执行一次 `ops/windows/backup.ps1`，保存生成的 manifest 与 SHA-256 校验结果；恢复演练由受控维护窗口另行完成。
4. 创建试点 Project、Engineer/SeniorEngineer/Viewer 用户与项目成员关系。所有创建均保留原因和对应的 Audit 记录。

## 验收场景

| 场景 | 操作 | 通过标准 |
| --- | --- | --- |
| 组件树 | 创建至少三级 Component Tree 并尝试把根移动到后代 | 正常移动保留 lineage；成环操作被拒绝 |
| 版本 | 为组件创建三个 opaque Version | sequence 为 10、20、30；Version Number 未被解析为数值 |
| 生命周期 | 发布一个版本并标记另一个为 Blocked | Maturity、Safety、Recommendation 独立呈现，Audit 可追溯 |
| Baseline | 创建、发布 Rev1，再创建 Rev2 | 已发布 Rev1 不可改；Rev2 使用新 Revision |
| Target | 为部分机台显式分配 Rev1，随后将 Project Standard 改为 Rev2 | 已分配机台仍保持 Rev1，未分配机台不自动获得 Target |
| Observation | 录入 FULL Initial Snapshot、PARTIAL Observation、FULL Observation | PARTIAL 不丢失未观察组件；FULL 明确投影缺失组件为 Absent；Observed At 不覆盖 Installed At |
| Drift/Risk | Target 与 Actual 相同后将版本标为 Blocked | Match 为 Matched，Risk 为 Critical |
| Import | 先以 CSV Preview 导入，再 Commit | 无效行只停留在 staging；Commit 经同一 Domain Command 创建版本 |
| 权限 | 分别以 Viewer、Engineer、SeniorEngineer 登录 | Viewer 不能写；Engineer 仅能写有成员关系项目；SeniorEngineer 才能做 Baseline/Target/Lifecycle 高级写入 |

## 试点退出门槛

1. 上表每项均有通过记录，例外项包含负责人、原因和处理结论。
2. 每个关键写入可按 actor、reason、correlation id 或 Idempotency-Key 在 Audit 中检索。
3. 试点数据至少完成一次 Online Backup；恢复演练在独立维护窗口完成并形成单独记录。
4. 工程师确认中文界面满足日常项目、Baseline、Machine、Observation、Drift、Search 和 Import 工作流。
5. 未解决的高风险问题为零；其余问题进入明确的后续版本 Backlog。

## 交付记录

记录以下不可变证据，而不记录密码或连接字符串：

- `preflight.ps1` 和 `health-check.ps1` 输出。
- 发布包版本与 `release-manifest.json` 的 SHA-256。
- 备份 manifest 与校验结果。
- 每个验收场景的执行人、时间、结果和 Audit 关联标识。
- 问题列表、严重度、负责人和关闭结论。
