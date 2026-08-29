# Core V1 Decision Lock

Status: **Frozen for Core V1**  
Date: 2026-08-29

本文把 `PLAN.md` 中已经确认、且一旦进入 Migration 后不应随意改变的决策锁定下来。后续变化必须新增 ADR；不能通过直接改写历史 ADR 偷换语义。

## Locked decisions

1. 生产形态为 Windows Server、IIS、单 ASP.NET Core Application、PostgreSQL 和独立 Windows Worker；不引入 Linux VM、Docker 或微服务。
2. Released Baseline 不可变；修订通过新的 Baseline Revision 表达。
3. Project Standard、Machine Target 与 Machine Actual 是三套独立状态。
4. Machine Target 与 Project Standard 使用时间区间历史，并由 PostgreSQL exclusion constraint 保证不重叠。
5. Actual History 使用 DeploymentBatch + DeploymentItem；Batch 明确 operation、source、coverage。
6. FULL Observation 会为缺失的当前组件生成显式 ABSENT/REMOVE Fact；PARTIAL 不从缺失推导移除。
7. Current Machine Configuration 是可重建投影；Observation Time 不等于 Installed Time。
8. Version Number 是 opaque string；同一 Component 的工程顺序由显式 `sequence_no` 表达。
9. Version Maturity 与 Safety 分轴；Block/Unblock 不改变 Maturity。
10. 关键命令使用数据库持久化幂等记录；外部事件使用 source + external_event_id 去重。
11. 核心身份、关系和时态字段采用关系模型；JSONB 只承载扩展元数据或请求/结果快照。
12. Import Adapter 与 Domain 分离，统一经过 Preview → Validate → Dry Run → Commit。

## Change control

- 实现细节可在不破坏上述语义的前提下迭代。
- 修改锁定决策必须新增 Superseding ADR，说明迁移、历史数据和兼容性影响。
- Core V1 Migration 一旦进入共享测试环境，不允许重写已执行 migration；只能追加 migration。

