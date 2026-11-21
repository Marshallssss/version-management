using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using ConfigHub.Infrastructure.Persistence;
using ConfigHub.Infrastructure.Persistence.Entities;
using Microsoft.EntityFrameworkCore;

namespace ConfigHub.Host.Catalog;

public static partial class CatalogEndpoints
{
    private static HashSet<Guid> PmComponentIds(IReadOnlyList<ConfigurationComponent> components)
    {
        var root = components.SingleOrDefault(c => c.IsPmRoot);
        if (root is null) return [];
        var ids = new HashSet<Guid> { root.Id };
        while (true)
        {
            var next = components.Where(c => c.ParentComponentId is { } parent && ids.Contains(parent) && !ids.Contains(c.Id)).Select(c => c.Id).ToArray();
            if (next.Length == 0) return ids;
            ids.UnionWith(next);
        }
    }

    private static async Task<IResult> GetPmConfigurationAsync(Guid projectId, IDbContextFactory<ConfigHubDbContext> factory, CancellationToken ct)
    {
        await using var db = await factory.CreateDbContextAsync(ct);
        if (!await db.Projects.AnyAsync(p => p.Id == projectId, ct)) return Results.NotFound();
        var components = await db.ConfigurationComponents.AsNoTracking().Where(c => c.ProjectId == projectId).ToListAsync(ct);
        return Results.Ok(new { rootComponentId = components.SingleOrDefault(c => c.IsPmRoot)?.Id, componentIds = PmComponentIds(components) });
    }

    private static async Task<IResult> SetPmConfigurationAsync(Guid projectId, PmRootRequest request, HttpContext context, IDbContextFactory<ConfigHubDbContext> factory, CancellationToken ct)
    {
        var error = ValidateRequired(request.Reason, "关联原因", 500);
        if (error is not null) return Results.ValidationProblem(error);
        var key = context.Request.Headers["Idempotency-Key"].FirstOrDefault();
        if (string.IsNullOrWhiteSpace(key) || key.Length > 200) return Results.BadRequest(new { message = "必须提供有效幂等键。" });
        await using var db = await factory.CreateDbContextAsync(ct);
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        if (await db.Projects.FromSqlInterpolated($"SELECT * FROM projects WHERE id = {projectId} FOR UPDATE").SingleOrDefaultAsync(ct) is null) return Results.NotFound();
        if (!await HasProjectWriteAccessAsync(db, context, projectId, ct, requireSeniorMembership: true)) return Results.Forbid();
        var scope = $"project-pm-root:{projectId}";
        var hash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(request))));
        var replay = await db.IdempotencyRecords.SingleOrDefaultAsync(r => r.Scope == scope && r.IdempotencyKey == key, ct);
        if (replay is not null) return replay.RequestHash == hash && replay.Result is not null ? Results.Ok(replay.Result.RootElement.Clone()) : Results.Conflict(new { message = "幂等键已用于不同操作。" });
        var components = await db.ConfigurationComponents.FromSqlInterpolated($"SELECT * FROM configuration_components WHERE project_id = {projectId} ORDER BY id FOR UPDATE").ToListAsync(ct);
        var selected = components.SingleOrDefault(c => c.Id == request.RootComponentId);
        if (request.RootComponentId is not null && (selected is null || selected.ParentComponentId is not null)) return Results.BadRequest(new { message = "请选择本项目的根组件作为 PM 配置分类。" });
        var previous = components.SingleOrDefault(c => c.IsPmRoot);
        if (previous is not null) previous.IsPmRoot = false;
        await db.SaveChangesAsync(ct);
        if (selected is not null) selected.IsPmRoot = true;
        AddAuditEvent(db, context, "ProjectPmRootChanged", "Project", projectId, new { previousRootComponentId = previous?.Id, request.RootComponentId, request.Reason });
        var now = DateTimeOffset.UtcNow;
        var result = new { rootComponentId = request.RootComponentId };
        db.IdempotencyRecords.Add(new() { Id = Guid.NewGuid(), Scope = scope, IdempotencyKey = key, RequestHash = hash, CreatedAt = now, ExpiresAt = now.AddDays(7), Status = IdempotencyRecordStatus.Completed, Result = JsonSerializer.SerializeToDocument(result) });
        await db.SaveChangesAsync(ct); await tx.CommitAsync(ct);
        return Results.Ok(result);
    }

    // Called inside the whole-machine fact transaction and lock. Validation precedes any PM writes.
    private static async Task<IResult?> ApplyPmObservationsAsync(ConfigHubDbContext db, Machine machine, RecordFactsRequest request, DeploymentBatch batch, HttpContext context, CancellationToken ct)
    {
        var inputs = request.PmObservations ?? [];
        if (!request.MultiVersion) return inputs.Count == 0 ? null : Results.BadRequest(new { message = "请明确勾选整机多版本后提交 PM 配置。" });
        if (batch.OperationType != DeploymentOperationType.Observation || batch.Coverage != ObservationCoverage.Partial || inputs.Count is < 1 or > 600)
            return Results.BadRequest(new { message = "整机多版本仅用于局部观察，请选择至少一个已安装 PM。" });
        if (batch.EffectiveAt > DateTimeOffset.UtcNow.AddMinutes(1) || inputs.Any(i => i.Number is < 1 or > 6 || i.State is not ("Override" or "Inherit" or "Unknown")) || inputs.Select(i => (i.Number, i.ComponentId)).Distinct().Count() != inputs.Count)
            return Results.BadRequest(new { message = "PM、组件或配置状态无效，不能重复提交同一个 PM 组件或填写未来观察时间。" });
        var components = await db.ConfigurationComponents.FromSqlInterpolated($"SELECT * FROM configuration_components WHERE project_id = {machine.ProjectId} ORDER BY id FOR SHARE").ToListAsync(ct);
        var allowed = PmComponentIds(components);
        if (allowed.Count == 0) return Results.Conflict(new { message = "请先关联本项目的 PM 根组件。" });
        if (inputs.Any(i => !allowed.Contains(i.ComponentId))) return Results.BadRequest(new { message = "只能记录所关联 PM 根组件及其子组件。" });
        var chambers = await db.MachineChambers.Where(c => c.MachineId == machine.Id && c.Installed).ToDictionaryAsync(c => c.Number, ct);
        if (inputs.Any(i => !chambers.ContainsKey(i.Number))) return Results.BadRequest(new { message = "只能为已安装的 PM 登记版本。" });
        var versionIds = inputs.Where(i => i.VersionId != null).Select(i => i.VersionId!.Value).ToArray();
        var versions = await db.ComponentVersions.Where(v => versionIds.Contains(v.Id)).ToDictionaryAsync(v => v.Id, ct);
        var revisionIds = inputs.Where(i => i.RevisionId != null).Select(i => i.RevisionId!.Value).ToArray();
        var revisions = await db.ComponentVersionRevisions.Where(r => revisionIds.Contains(r.Id)).ToDictionaryAsync(r => r.Id, ct);
        if (inputs.Any(i => i.State == "Override" ? i.VersionId is null || !versions.TryGetValue(i.VersionId.Value, out var v) || v.ComponentId != i.ComponentId || i.RevisionId is { } r && (!revisions.TryGetValue(r, out var revision) || revision.ComponentVersionId != i.VersionId) : i.VersionId is not null || i.RevisionId is not null))
            return Results.BadRequest(new { message = "PM 版本和修订必须属于所选组件；沿用整机或未知状态不能携带版本。" });
        var componentIds = inputs.Select(i => i.ComponentId).Distinct().ToArray();
        var versioned = await db.ComponentVersions.Where(v => componentIds.Contains(v.ComponentId)).Select(v => v.ComponentId).Distinct().ToListAsync(ct);
        if (componentIds.Except(versioned).Any()) return Results.BadRequest(new { message = "结构分类节点没有可观察的软件版本。" });
        var chamberIds = chambers.Values.Select(c => c.Id).ToArray();
        var facts = await db.MachineChamberVersions.Where(f => chamberIds.Contains(f.ChamberId)).ToListAsync(ct);
        var historyIds = facts.Select(f => f.HistoryId).Distinct().ToArray();
        var recordedTimes = await db.MachineEquipmentHistory.Where(h => historyIds.Contains(h.Id)).ToDictionaryAsync(h => h.Id, h => h.RecordedAt, ct);
        foreach (var input in inputs)
        {
            var last = facts.Where(f => f.ChamberId == chambers[input.Number].Id && f.ComponentId == input.ComponentId).MaxBy(f => f.Sequence);
            if (last is not null && batch.EffectiveAt < (last.EffectiveAt ?? recordedTimes[last.HistoryId])) return Results.Conflict(new { message = $"PM{input.Number} 已有更晚的记录，请核对观察时间。" });
        }
        foreach (var group in inputs.GroupBy(i => i.Number))
        {
            var chamber = chambers[group.Key];
            var history = EquipmentEvent(db, context, machine.Id, group.Key, "ChamberObserved", request.Reason!, new { deploymentBatchId = batch.Id, observedAt = batch.EffectiveAt, items = group.ToArray(), source = "PartialObservation" });
            var sequence = facts.Where(f => f.ChamberId == chamber.Id).Select(f => f.Sequence).DefaultIfEmpty(0).Max() + 1;
            foreach (var input in group)
            {
                var last = facts.Where(f => f.ChamberId == chamber.Id && f.ComponentId == input.ComponentId).MaxBy(f => f.Sequence);
                var installedAt = input.State == "Override" && last is not null && last.VersionId == input.VersionId && last.RevisionId == input.RevisionId ? last.KnownInstalledAt : null;
                db.MachineChamberVersions.Add(new() { Id = Guid.NewGuid(), ChamberId = chamber.Id, ComponentId = input.ComponentId, VersionId = input.VersionId, RevisionId = input.RevisionId, IsUnknown = input.State == "Unknown", EffectiveAt = batch.EffectiveAt, KnownInstalledAt = installedAt, Sequence = sequence, HistoryId = history.Id });
            }
        }
        return null;
    }
}

public sealed record PmRootRequest(Guid? RootComponentId, string? Reason);
public sealed record PmObservationInput(int Number, Guid ComponentId, string State, Guid? VersionId = null, Guid? RevisionId = null);
