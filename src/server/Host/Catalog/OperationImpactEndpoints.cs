using ConfigHub.Infrastructure.Persistence;
using ConfigHub.Infrastructure.Persistence.Entities;
using Microsoft.EntityFrameworkCore;

namespace ConfigHub.Host.Catalog;

public static partial class CatalogEndpoints
{
    private static async Task<IResult> GetVersionOperationImpactAsync(
        Guid versionId, HttpContext context, IConfiguration configuration,
        IDbContextFactory<ConfigHubDbContext> factory, CancellationToken cancellationToken)
    {
        if (!context.User.IsInRole("SuperAdmin")) return Results.Forbid();
        await using var db = await factory.CreateDbContextAsync(cancellationToken);
        var version = await (from item in db.ComponentVersions.AsNoTracking()
            join component in db.ConfigurationComponents.AsNoTracking() on item.ComponentId equals component.Id
            where item.Id == versionId
            select new { item.Id, item.VersionNumber, item.ComponentId, ComponentName = component.Name })
            .SingleOrDefaultAsync(cancellationToken);
        if (version is null) return Results.NotFound();

        // This preview mirrors every deletion blocker, including historical references hidden from active machine lists.
        var baselines = db.ConfigurationBaselines.AsNoTracking()
            .Where(item => item.TopComponentVersionId == versionId || db.BaselineItems.Any(snapshot =>
                snapshot.ConfigurationBaselineId == item.Id && snapshot.ComponentVersionId == versionId))
            .OrderByDescending(item => item.CreatedAt).ThenBy(item => item.Id)
            .Select(item => new OperationImpactItem(item.Id, item.BaselineCode,
                item.State == BaselineState.Released ? "已发布基线" : item.State == BaselineState.Draft ? "草稿基线" : "历史基线",
                null, item.Id, false));
        var currentMachines = from actual in db.MachineCurrentConfigurations.AsNoTracking()
            join machine in db.Machines.IgnoreQueryFilters().AsNoTracking() on actual.MachineId equals machine.Id
            where actual.ComponentVersionId == versionId
            orderby machine.Name, machine.Id
            select new OperationImpactItem(machine.Id, machine.Name, "整机当前配置", machine.Id, null, machine.DeletedAt != null);
        var machineHistory = from item in db.DeploymentItems.AsNoTracking()
            join batch in db.DeploymentBatches.AsNoTracking() on item.DeploymentBatchId equals batch.Id
            join machine in db.Machines.IgnoreQueryFilters().AsNoTracking() on batch.MachineId equals machine.Id
            where item.NewComponentVersionId == versionId
            orderby batch.RecordedAt descending, item.Id
            select new OperationImpactItem(item.Id, machine.Name, "整机配置历史", machine.Id, null, machine.DeletedAt != null);
        var chamberHistory = from fact in db.MachineChamberVersions.AsNoTracking()
            join chamber in db.MachineChambers.AsNoTracking() on fact.ChamberId equals chamber.Id
            join machine in db.Machines.IgnoreQueryFilters().AsNoTracking() on chamber.MachineId equals machine.Id
            where fact.VersionId == versionId
            orderby fact.Sequence descending, fact.Id
            select new OperationImpactItem(fact.Id, machine.Name,
                "PM" + chamber.Number + (chamber.Installed ? " 特例历史" : " 特例历史（腔室已移除）"),
                machine.Id, null, machine.DeletedAt != null);
        var exposures = db.VersionExposureSnapshots.AsNoTracking().Where(item => item.ComponentVersionId == versionId)
            .OrderByDescending(item => item.BlockedAt).ThenBy(item => item.Id)
            .Select(item => new OperationImpactItem(item.Id, "风险影响快照", item.Reason, null, null, false));
        var templates = db.MatrixImportTemplates.AsNoTracking()
            .Where(item => db.MatrixImportReferences.Any(reference => reference.TemplateId == item.Id
                && reference.CombinationId == null && reference.VersionId == versionId))
            .OrderByDescending(item => item.CreatedAt).ThenBy(item => item.Id)
            .Select(item => new OperationImpactItem(item.Id, "Excel 模板冻结参考",
                item.ReferenceBaselineCode ?? "生成时的参考配置", null, null, false));
        var combinations = db.MatrixImportCombinations.AsNoTracking()
            .Where(item => db.MatrixImportReferences.Any(reference => reference.CombinationId == item.Id && reference.VersionId == versionId))
            .OrderByDescending(item => item.CreatedAt).ThenBy(item => item.Id)
            .Select(item => new OperationImpactItem(item.Id, "Excel 第 " + item.SequenceNo + " 套测试组合",
                item.Reason, null, null, false));
        var laboratory = from validation in db.LaboratoryValidations.AsNoTracking()
            join machine in db.Machines.IgnoreQueryFilters().AsNoTracking() on validation.MachineId equals machine.Id
            where validation.ComponentVersionId == versionId
            orderby validation.RecordedAt descending, validation.Id
            select new OperationImpactItem(validation.Id, machine.Name,
                validation.ChamberNumber == null ? "整机 Lab 验证记录" : "PM" + validation.ChamberNumber + " Lab 验证记录",
                machine.Id, null, machine.DeletedAt != null);
        OperationImpactGroup[] groups =
        [
            await BuildOperationImpactGroupAsync("baselines", "引用基线", baselines, cancellationToken),
            await BuildOperationImpactGroupAsync("current-machines", "整机当前配置", currentMachines, cancellationToken),
            await BuildOperationImpactGroupAsync("machine-history", "整机配置历史", machineHistory, cancellationToken),
            await BuildOperationImpactGroupAsync("chamber-history", "PM 特例历史", chamberHistory, cancellationToken),
            await BuildOperationImpactGroupAsync("exposure-snapshots", "风险影响快照", exposures, cancellationToken),
            await BuildOperationImpactGroupAsync("matrix-templates", "Excel 模板参考", templates, cancellationToken),
            await BuildOperationImpactGroupAsync("matrix-combinations", "Excel 测试组合", combinations, cancellationToken),
            await BuildOperationImpactGroupAsync("laboratory-validations", "Lab 验证记录", laboratory, cancellationToken)
        ];
        var cleanupCounts = new VersionCleanupCounts(
            await db.VersionPatches.CountAsync(item => item.ComponentVersionId == versionId, cancellationToken),
            await db.VersionLifecycleTransitions.CountAsync(item => item.ComponentVersionId == versionId, cancellationToken),
            await db.VersionRecommendations.CountAsync(item => item.ComponentVersionId == versionId, cancellationToken));
        return Results.Ok(new VersionOperationImpact(version.Id, version.VersionNumber, version.ComponentId,
            version.ComponentName, groups.All(group => group.Total == 0),
            configuration.GetValue<bool>("ConfigHub:TestDataMaintenanceEnabled"), cleanupCounts, groups));
    }

    private static async Task<IResult> GetBaselineOperationImpactAsync(
        Guid baselineId, HttpContext context, IConfiguration configuration,
        IDbContextFactory<ConfigHubDbContext> factory, CancellationToken cancellationToken)
    {
        await using var db = await factory.CreateDbContextAsync(cancellationToken);
        var baseline = await db.ConfigurationBaselines.AsNoTracking().SingleOrDefaultAsync(item => item.Id == baselineId, cancellationToken);
        if (baseline is null) return Results.NotFound();
        if (!await HasProjectWriteAccessAsync(db, context, baseline.ProjectId, cancellationToken, requireSeniorMembership: true)) return Results.Forbid();

        var standards = from assignment in db.ProjectStandardAssignments.AsNoTracking()
            join project in db.Projects.AsNoTracking() on assignment.ProjectId equals project.Id
            where assignment.ConfigurationBaselineId == baselineId
            orderby assignment.ValidFrom descending, assignment.Id
            select new OperationImpactItem(assignment.Id, project.Name,
                assignment.ValidTo == null ? "当前项目标准" : "历史项目标准", null, baselineId, false);
        var targets = from assignment in db.MachineTargetAssignments.AsNoTracking()
            join machine in db.Machines.IgnoreQueryFilters().AsNoTracking() on assignment.MachineId equals machine.Id
            where assignment.ConfigurationBaselineId == baselineId
            orderby assignment.ValidFrom descending, assignment.Id
            select new OperationImpactItem(assignment.Id, machine.Name,
                assignment.ValidTo == null ? "当前目标基线" : "历史目标基线", machine.Id, baselineId, machine.DeletedAt != null);
        var deployments = from batch in db.DeploymentBatches.AsNoTracking()
            join machine in db.Machines.IgnoreQueryFilters().AsNoTracking() on batch.MachineId equals machine.Id
            where batch.SourceConfigurationBaselineId == baselineId
            orderby batch.RecordedAt descending, batch.Id
            select new OperationImpactItem(batch.Id, machine.Name, "基线配置录入历史", machine.Id, baselineId, machine.DeletedAt != null);
        var successors = db.ConfigurationBaselines.AsNoTracking().Where(item => item.SupersedesBaselineId == baselineId)
            .OrderByDescending(item => item.CreatedAt).ThenBy(item => item.Id)
            .Select(item => new OperationImpactItem(item.Id, item.BaselineCode, "后续修订", null, item.Id, false));
        OperationImpactGroup[] groups =
        [
            await BuildOperationImpactGroupAsync("project-standards", "项目标准记录", standards, cancellationToken),
            await BuildOperationImpactGroupAsync("machine-targets", "机台目标记录", targets, cancellationToken),
            await BuildOperationImpactGroupAsync("deployment-history", "基线配置录入历史", deployments, cancellationToken),
            await BuildOperationImpactGroupAsync("successors", "后续基线修订", successors, cancellationToken)
        ];
        var withdrawUntil = baseline.ReleasedAt?.AddMinutes(3);
        List<string> blockedReasons = [];
        if (baseline.State != BaselineState.Released || withdrawUntil is null) blockedReasons.Add("只有正式发布的基线可以撤回。");
        else if (DateTimeOffset.UtcNow > withdrawUntil) blockedReasons.Add("已超过发布后 3 分钟的撤回期限。");
        foreach (var group in groups.Where(group => group.Total > 0)) blockedReasons.Add($"已有{group.Label}引用，不能撤回。");
        return Results.Ok(new BaselineOperationImpact(baseline.Id, baseline.BaselineCode, baseline.State.ToString(),
            blockedReasons.Count == 0, withdrawUntil, blockedReasons,
            configuration.GetValue<bool>("ConfigHub:TestDataMaintenanceEnabled"), groups));
    }

    private static async Task<OperationImpactGroup> BuildOperationImpactGroupAsync(
        string kind, string label, IQueryable<OperationImpactItem> query, CancellationToken cancellationToken)
        => new(kind, label, await query.CountAsync(cancellationToken), await query.Take(10).ToArrayAsync(cancellationToken));
}

public sealed record OperationImpactItem(Guid Id, string Label, string? Detail, Guid? MachineId, Guid? BaselineId, bool Deleted);
public sealed record OperationImpactGroup(string Kind, string Label, int Total, OperationImpactItem[] Items);
public sealed record VersionCleanupCounts(int Patches, int LifecycleTransitions, int Recommendations);
public sealed record VersionOperationImpact(Guid VersionId, string VersionNumber, Guid ComponentId, string ComponentName,
    bool CanDelete, bool MaintenanceEnabled, VersionCleanupCounts CleanupCounts, OperationImpactGroup[] Groups);
public sealed record BaselineOperationImpact(Guid BaselineId, string BaselineCode, string State, bool CanWithdraw,
    DateTimeOffset? WithdrawUntil, List<string> BlockedReasons, bool MaintenanceEnabled, OperationImpactGroup[] Groups);
