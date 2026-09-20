using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using ConfigHub.Infrastructure.Persistence;
using ConfigHub.Infrastructure.Persistence.Entities;
using Microsoft.EntityFrameworkCore;

namespace ConfigHub.Host.Catalog;

public static partial class CatalogEndpoints
{
    private static void MapLaboratoryEndpoints(IEndpointRouteBuilder endpoints)
    {
        endpoints.MapGet("/api/v1/projects/{projectId:guid}/laboratory-versions", GetLaboratoryVersionsAsync).RequireAuthorization();
        endpoints.MapPost("/api/v1/projects/{projectId:guid}/laboratory-deployments", RecordLaboratorySelectionAsync).RequireAuthorization("Engineer");
        endpoints.MapPost("/api/v1/component-versions/{versionId:guid}/laboratory-deployments", RecordLaboratoryDeploymentAsync).RequireAuthorization("Engineer");
        endpoints.MapPost("/api/v1/component-versions/{versionId:guid}/laboratory-validations", RecordLaboratoryValidationAsync).RequireAuthorization("Engineer");
    }

    private sealed record LaboratoryUse(Guid MachineId, string MachineName, string SerialNumber, string? Location, string? MachineStage,
        int? ChamberNumber, string? ChamberStage, string Kind, Guid EvidenceId, string EvidenceKind, DateTimeOffset? InstalledAt);

    private static string LaboratoryValidationStatus(IEnumerable<LaboratoryValidation> records)
    {
        var passed = false;
        foreach (var scope in records.GroupBy(record => new { record.MachineId, record.ChamberNumber }))
        {
            var ordered = scope.OrderByDescending(record => record.RecordedAt).ToArray();
            // Starting a retest does not resolve a failed conclusion; a subsequent pass does.
            if (ordered.FirstOrDefault(record => record.Result != "InProgress")?.Result == "Failed") return "Failed";
            passed |= ordered[0].Result == "Passed";
        }
        return passed ? "Passed" : "InProgress";
    }

    private static async Task<Dictionary<Guid, List<LaboratoryUse>>> ReadLaboratoryUsesAsync(ConfigHubDbContext db, Guid projectId, CancellationToken ct)
    {
        var machines = await db.Machines.AsNoTracking().Where(machine => machine.ProjectId == projectId).ToListAsync(ct);
        var machineIds = machines.Select(machine => machine.Id).ToArray();
        var actual = await db.MachineCurrentConfigurations.AsNoTracking().Where(item => machineIds.Contains(item.MachineId) && item.State == CurrentConfigurationState.Present && item.ComponentVersionId != null).ToListAsync(ct);
        var chambers = await db.MachineChambers.AsNoTracking().Where(chamber => machineIds.Contains(chamber.MachineId) && chamber.Installed && chamber.Stage == "Lab").ToListAsync(ct);
        var chamberIds = chambers.Select(chamber => chamber.Id).ToArray();
        var facts = await db.MachineChamberVersions.AsNoTracking().Where(fact => chamberIds.Contains(fact.ChamberId)).ToListAsync(ct);
        var historyIds = facts.Select(fact => fact.HistoryId).Distinct().ToArray();
        var histories = await db.MachineEquipmentHistory.AsNoTracking().Where(history => historyIds.Contains(history.Id)).ToDictionaryAsync(history => history.Id, ct);
        var result = new Dictionary<Guid, List<LaboratoryUse>>();
        void Add(Guid versionId, LaboratoryUse use)
        {
            if (!result.TryGetValue(versionId, out var uses)) result[versionId] = uses = [];
            uses.Add(use);
        }
        foreach (var machine in machines)
        {
            var whole = actual.Where(item => item.MachineId == machine.Id).ToDictionary(item => item.ConfigurationComponentId);
            if (machine.Stage == "Lab")
                foreach (var item in whole.Values)
                    Add(item.ComponentVersionId!.Value, new(machine.Id, machine.Name, machine.SerialNumber, machine.Location, machine.Stage, null, null, "Machine", item.SourceDeploymentItemId, "DeploymentItem", item.KnownInstalledAt));
            foreach (var chamber in chambers.Where(chamber => chamber.MachineId == machine.Id))
            {
                var current = facts.Where(fact => fact.ChamberId == chamber.Id).GroupBy(fact => fact.ComponentId).ToDictionary(group => group.Key, group => group.MaxBy(fact => fact.Sequence)!);
                foreach (var componentId in whole.Keys.Union(current.Keys))
                {
                    var overridden = current.GetValueOrDefault(componentId);
                    if (overridden?.VersionId is Guid versionId)
                    {
                        DateTimeOffset? installedAt = null;
                        if (histories.TryGetValue(overridden.HistoryId, out var history) && history.Details.RootElement.TryGetProperty("installedAt", out var installed) && installed.ValueKind == JsonValueKind.String && installed.TryGetDateTimeOffset(out var value)) installedAt = value;
                        Add(versionId, new(machine.Id, machine.Name, machine.SerialNumber, machine.Location, machine.Stage, chamber.Number, chamber.Stage, "ChamberOverride", overridden.Id, "ChamberVersion", installedAt));
                    }
                    else if (whole.TryGetValue(componentId, out var inherited))
                        Add(inherited.ComponentVersionId!.Value, new(machine.Id, machine.Name, machine.SerialNumber, machine.Location, machine.Stage, chamber.Number, chamber.Stage, "ChamberInherited", inherited.SourceDeploymentItemId, "DeploymentItem", inherited.KnownInstalledAt));
                }
            }
        }
        return result;
    }

    private static async Task<IResult> GetLaboratoryVersionsAsync(Guid projectId, HttpContext context, IDbContextFactory<ConfigHubDbContext> factory, CancellationToken ct)
    {
        await using var db = await factory.CreateDbContextAsync(ct);
        if (!await db.Projects.AnyAsync(project => project.Id == projectId && project.Status == ProjectStatus.Active, ct)) return Results.NotFound();
        var versions = await db.ComponentVersions.AsNoTracking().Where(version => db.ConfigurationComponents.Any(component => component.ProjectId == projectId && component.Id == version.ComponentId)).ToListAsync(ct);
        var versionIds = versions.Select(version => version.Id).ToArray();
        var componentNames = await db.ConfigurationComponents.Where(component => component.ProjectId == projectId).ToDictionaryAsync(component => component.Id, component => component.Name, ct);
        var uses = await ReadLaboratoryUsesAsync(db, projectId, ct);
        var validations = await db.LaboratoryValidations.AsNoTracking().Where(validation => versionIds.Contains(validation.ComponentVersionId)).OrderByDescending(validation => validation.RecordedAt).ToListAsync(ct);
        var testingRounds = await db.VersionLifecycleTransitions.AsNoTracking().Where(x => versionIds.Contains(x.ComponentVersionId) && x.Axis == LifecycleAxis.Maturity && x.ToState == "Testing").ToListAsync(ct);
        string Status(ComponentVersion version)
        {
            var since = testingRounds.Where(x => x.ComponentVersionId == version.Id).Select(x => x.OccurredAt).DefaultIfEmpty(version.CreatedAt).Max();
            return LaboratoryValidationStatus(validations.Where(x => x.ComponentVersionId == version.Id && x.OccurredAt >= since));
        }
        var machineIds = validations.Select(validation => validation.MachineId).ToArray();
        var historicalMachines = await db.Machines.IgnoreQueryFilters().AsNoTracking().Where(machine => machineIds.Contains(machine.Id)).ToDictionaryAsync(machine => machine.Id, ct);
        var machines = await db.Machines.AsNoTracking().Where(machine => machine.ProjectId == projectId).OrderBy(machine => machine.Location).ThenBy(machine => machine.Name).ToListAsync(ct);
        var currentIds = machines.Select(machine => machine.Id).ToArray();
        var chambers = await db.MachineChambers.AsNoTracking().Where(chamber => currentIds.Contains(chamber.MachineId) && chamber.Installed && chamber.Stage == "Lab").OrderBy(chamber => chamber.Number).ToListAsync(ct);
        return Results.Ok(new
        {
            releaseValidationRequired = context.RequestServices.GetRequiredService<IConfiguration>().GetValue<bool>("ConfigHub:Laboratory:RequirePassedValidationForRelease"),
            targets = machines.SelectMany(machine => (machine.Stage == "Lab" ? new[] { new { machineId = machine.Id, machineName = machine.Name, machine.SerialNumber, machine.Location, machineStage = (string?)machine.Stage, chamberNumber = (int?)null } } : [])
                .Concat(chambers.Where(chamber => chamber.MachineId == machine.Id).Select(chamber => new { machineId = machine.Id, machineName = machine.Name, machine.SerialNumber, machine.Location, machineStage = machine.Stage, chamberNumber = (int?)chamber.Number }))),
            versions = versions.Select(version => new
            {
                versionId = version.Id, version.ComponentId, version.VersionNumber, componentName = componentNames[version.ComponentId], maturity = version.Maturity.ToString(),
                validationStatus = Status(version),
                currentUses = uses.GetValueOrDefault(version.Id) ?? [],
                validations = validations.Where(validation => validation.ComponentVersionId == version.Id).Select(validation => new
                {
                    validation.Id, validation.MachineId, machineName = historicalMachines.GetValueOrDefault(validation.MachineId)?.Name ?? "已删除机台",
                    machineDeleted = historicalMachines.GetValueOrDefault(validation.MachineId)?.DeletedAt != null,
                    validation.ChamberNumber, validation.Result, validation.OccurredAt, validation.RecordedAt, validation.Actor, validation.Reason,
                    validation.MachineStage, validation.ChamberStage, validation.EvidenceKind, validation.EvidenceId
                })
            })
        });
    }

    private static async Task<IResult> RecordLaboratorySelectionAsync(Guid projectId, LaboratorySelectionRequest request, HttpContext context, IDbContextFactory<ConfigHubDbContext> factory, CancellationToken ct)
    {
        if (request.VersionIds is null || request.VersionIds.Count is < 1 or > 100 || request.VersionIds.Distinct().Count() != request.VersionIds.Count)
            return Results.BadRequest(new { message = "请选择 1 至 100 个不重复的测试版本。" });
        await using var db = await factory.CreateDbContextAsync(ct);
        if (!await HasProjectWriteAccessAsync(db, context, projectId, ct)) return Results.Forbid();
        if (!await db.Machines.AnyAsync(machine => machine.Id == request.MachineId && machine.ProjectId == projectId, ct))
            return Results.BadRequest(new { message = "机台不属于当前项目。" });
        var versions = await db.ComponentVersions.Where(version => request.VersionIds.Contains(version.Id)
            && db.ConfigurationComponents.Any(component => component.Id == version.ComponentId && component.ProjectId == projectId)).OrderBy(version => version.ComponentId).ToListAsync(ct);
        if (versions.Count != request.VersionIds.Count || versions.Select(version => version.ComponentId).Distinct().Count() != versions.Count)
            return Results.BadRequest(new { message = "所有版本必须属于当前项目，每个组件只能选择一个版本。" });
        if (request.ChamberNumber is not null)
            return await ChangeMachineEquipmentAsync(request.MachineId,
                new(request.Reason, Items: versions.Select(version => new ChamberVersionInput(version.ComponentId, version.Id)).ToList(), Partial: true, InstalledAt: request.InstalledAt.ToUniversalTime(), LaboratoryOnly: true),
                "overrides", request.ChamberNumber, context, factory, ct);
        return await RecordFactsCoreAsync(request.MachineId,
            new("Upgrade", "Partial", "laboratory-registration", null, request.InstalledAt.ToUniversalTime(), request.Reason,
                versions.Select(version => new RecordFactItem(version.ComponentId, version.Id, false, request.InstalledAt.ToUniversalTime())).ToList()),
            context, factory, context.Request.Headers["Idempotency-Key"].FirstOrDefault(), ct, laboratoryOnly: true);
    }

    private static async Task<IResult> RecordLaboratoryDeploymentAsync(Guid versionId, LaboratoryDeploymentRequest request, HttpContext context, IDbContextFactory<ConfigHubDbContext> factory, CancellationToken ct)
    {
        await using var db = await factory.CreateDbContextAsync(ct);
        var version = await db.ComponentVersions.AsNoTracking().SingleOrDefaultAsync(version => version.Id == versionId, ct);
        if (version is null) return Results.NotFound();
        if (request.ChamberNumber is not null)
            return await ChangeMachineEquipmentAsync(request.MachineId,
                new(request.Reason, Items: [new(version.ComponentId, versionId)], Partial: true, InstalledAt: request.InstalledAt.ToUniversalTime(), LaboratoryOnly: true),
                "overrides", request.ChamberNumber, context, factory, ct);
        return await RecordFactsCoreAsync(request.MachineId,
            new("Upgrade", "Partial", "laboratory-registration", null, request.InstalledAt.ToUniversalTime(), request.Reason, [new(version.ComponentId, versionId, false, request.InstalledAt.ToUniversalTime())]),
            context, factory, context.Request.Headers["Idempotency-Key"].FirstOrDefault(), ct, laboratoryOnly: true);
    }

    private static async Task<IResult> RecordLaboratoryValidationAsync(Guid versionId, LaboratoryValidationRequest request, HttpContext context, IDbContextFactory<ConfigHubDbContext> factory, CancellationToken ct)
    {
        var validation = ValidateRequired(request.Reason, "验证说明", 500);
        if (validation is not null) return Results.ValidationProblem(validation);
        if (request.Result is not ("InProgress" or "Passed" or "Failed") || request.OccurredAt == default || request.OccurredAt > DateTimeOffset.UtcNow.AddMinutes(1))
            return Results.BadRequest(new { message = "请选择有效验证结果，并填写不晚于现在的实际验证时间。" });
        var key = context.Request.Headers["Idempotency-Key"].FirstOrDefault();
        if (string.IsNullOrWhiteSpace(key) || key.Length > 200) return Results.BadRequest(new { message = "必须提供有效幂等键。" });
        await using var db = await factory.CreateDbContextAsync(ct);
        await using var transaction = await db.Database.BeginTransactionAsync(ct);
        var machine = await db.Machines.FromSqlInterpolated($"SELECT * FROM machines WHERE id = {request.MachineId} FOR UPDATE").SingleOrDefaultAsync(ct);
        if (machine is null) return Results.NotFound();
        if (!await HasProjectWriteAccessAsync(db, context, machine.ProjectId, ct)) return Results.Forbid();
        var version = await db.ComponentVersions.SingleOrDefaultAsync(version => version.Id == versionId, ct);
        if (version is null || !await db.ConfigurationComponents.AnyAsync(component => component.Id == version.ComponentId && component.ProjectId == machine.ProjectId, ct))
            return Results.BadRequest(new { message = "验证版本与机台必须属于同一项目。" });
        var scope = $"laboratory-validation:{versionId}";
        var hash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(request))));
        var replay = await db.IdempotencyRecords.SingleOrDefaultAsync(record => record.Scope == scope && record.IdempotencyKey == key, ct);
        if (replay is not null) return replay.RequestHash == hash && replay.Result is not null ? Results.Ok(replay.Result.RootElement.Clone()) : Results.Conflict(new { message = "幂等键已用于其他验证记录。" });
        if (version.Maturity != VersionMaturity.Testing) return Results.Conflict(new { message = "仅可为测试中的版本登记新的实验室验证。" });
        var testingSince = await db.VersionLifecycleTransitions.Where(transition => transition.ComponentVersionId == versionId
            && transition.Axis == LifecycleAxis.Maturity && transition.ToState == "Testing")
            .Select(transition => (DateTimeOffset?)transition.OccurredAt).MaxAsync(ct) ?? version.CreatedAt;
        if (request.OccurredAt < testingSince)
            return Results.BadRequest(new { message = "验证时间不能早于本轮版本进入测试的时间，请检查日期和秒数。" });
        var uses = await ReadLaboratoryUsesAsync(db, machine.ProjectId, ct);
        var evidence = uses.GetValueOrDefault(versionId)?.SingleOrDefault(use => use.MachineId == request.MachineId && use.ChamberNumber == request.ChamberNumber);
        if (evidence is null) return Results.Conflict(new { message = "所选 Lab 整机或腔室当前没有该版本的实际配置记录，请先登记实际升级。" });
        if (request.Result != "InProgress" && evidence.InstalledAt is null)
            return Results.Conflict(new { message = "该实际配置的安装时间未知，请先登记已完成的 Lab 升级，再填写验证结论。" });
        if (evidence.InstalledAt is DateTimeOffset installedAt && request.OccurredAt < installedAt)
            return Results.BadRequest(new { message = "验证时间不能早于已记录的实际升级时间。" });
        var now = DateTimeOffset.UtcNow;
        var record = new LaboratoryValidation
        {
            Id = Guid.NewGuid(), ComponentVersionId = versionId, MachineId = machine.Id, ChamberNumber = request.ChamberNumber,
            Result = request.Result, OccurredAt = request.OccurredAt.ToUniversalTime(), RecordedAt = now,
            Actor = context.User.Identity!.Name!, Reason = request.Reason!.Trim(), CorrelationId = context.Items["CorrelationId"]?.ToString() ?? context.TraceIdentifier,
            EvidenceId = evidence.EvidenceId, EvidenceKind = evidence.EvidenceKind, MachineStage = evidence.MachineStage ?? "", ChamberStage = evidence.ChamberStage
        };
        db.LaboratoryValidations.Add(record);
        AddAuditEvent(db, context, "LaboratoryValidationRecorded", "ComponentVersion", versionId, new { record.Id, record.MachineId, record.ChamberNumber, record.Result, record.OccurredAt, record.EvidenceId, record.EvidenceKind, record.Reason });
        var result = JsonSerializer.SerializeToDocument(new { id = record.Id, result = record.Result });
        db.IdempotencyRecords.Add(new() { Id = Guid.NewGuid(), Scope = scope, IdempotencyKey = key, RequestHash = hash, CreatedAt = now, ExpiresAt = now.AddDays(7), Status = IdempotencyRecordStatus.Completed, Result = result });
        await db.SaveChangesAsync(ct);
        await transaction.CommitAsync(ct);
        return Results.Ok(result.RootElement.Clone());
    }

    private static async Task<string?> ValidateLaboratoryReleaseAsync(ConfigHubDbContext db, HttpContext context, IEnumerable<Guid> versionIds, CancellationToken ct)
    {
        if (!context.RequestServices.GetRequiredService<IConfiguration>().GetValue<bool>("ConfigHub:Laboratory:RequirePassedValidationForRelease")) return null;
        var ids = versionIds.Distinct().ToArray();
        if (ids.Length == 0) return null;
        var versions = await db.ComponentVersions.Where(version => ids.Contains(version.Id)).ToListAsync(ct);
        var testing = await db.VersionLifecycleTransitions.AsNoTracking().Where(transition => ids.Contains(transition.ComponentVersionId) && transition.Axis == LifecycleAxis.Maturity && transition.ToState == "Testing").ToListAsync(ct);
        var records = await db.LaboratoryValidations.AsNoTracking().Where(record => ids.Contains(record.ComponentVersionId)).ToListAsync(ct);
        foreach (var id in ids)
        {
            var version = versions.SingleOrDefault(version => version.Id == id);
            var since = testing.Where(transition => transition.ComponentVersionId == id).Select(transition => transition.OccurredAt).DefaultIfEmpty(version?.CreatedAt ?? DateTimeOffset.UtcNow).Max();
            if (LaboratoryValidationStatus(records.Where(record => record.ComponentVersionId == id && record.OccurredAt >= since)) != "Passed")
                return $"版本 {version?.VersionNumber ?? "待登记版本"} 尚未通过本轮实验室验证，或仍有未解决的验证失败。请先登记 Lab 实际使用与验证结果。";
        }
        return null;
    }
}

public sealed record LaboratoryDeploymentRequest(Guid MachineId, int? ChamberNumber, DateTimeOffset InstalledAt, string? Reason);
public sealed record LaboratorySelectionRequest(Guid MachineId, int? ChamberNumber, List<Guid>? VersionIds, DateTimeOffset InstalledAt, string? Reason);
public sealed record LaboratoryValidationRequest(Guid MachineId, int? ChamberNumber, string Result, DateTimeOffset OccurredAt, string? Reason);
