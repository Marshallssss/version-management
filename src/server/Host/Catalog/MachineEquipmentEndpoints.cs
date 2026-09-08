using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using ConfigHub.Infrastructure.Persistence;
using ConfigHub.Infrastructure.Persistence.Entities;
using Microsoft.EntityFrameworkCore;

namespace ConfigHub.Host.Catalog;

public static partial class CatalogEndpoints
{
    private static readonly string[] EquipmentStages = ["Lab", "MoveIn", "T0", "T1", "T2", "T3", "STR", "HVM"];

    private static Dictionary<string, string[]>? ValidateEquipment(string? owner, string? stage, List<ChamberInput>? chambers)
    {
        if (owner?.Length > 160 || stage is not null && !EquipmentStages.Contains(stage)
            || chambers is not null && (chambers.Count > 6 || chambers.Select(x => x.Number).Distinct().Count() != chambers.Count
                || chambers.Any(x => x.Number is < 1 or > 6 || !EquipmentStages.Contains(x.Stage))))
            return new() { ["equipment"] = ["负责人最多 160 字；请选择有效阶段及不重复的 PM1～PM6 腔室。"] };
        return null;
    }

    private static MachineEquipmentHistory EquipmentEvent(ConfigHubDbContext db, HttpContext context, Guid machineId, int? number, string kind, string reason, object details)
    {
        var history = new MachineEquipmentHistory
        {
            Id = Guid.NewGuid(), MachineId = machineId, ChamberNumber = number, Kind = kind,
            Actor = context.User.Identity?.Name ?? throw new InvalidOperationException("Authenticated actor required."),
            CorrelationId = context.Items["CorrelationId"]?.ToString() ?? context.TraceIdentifier,
            Reason = reason.Trim(), RecordedAt = DateTimeOffset.UtcNow,
            Details = JsonSerializer.SerializeToDocument(details, JsonSerializerOptions.Web)
        };
        db.MachineEquipmentHistory.Add(history);
        AddAuditEvent(db, context, kind, "Machine", machineId, new { chamberNumber = number, reason, details });
        return history;
    }

    private static async Task ApplyEquipmentAsync(ConfigHubDbContext db, Machine machine, string? owner, string? stage, List<ChamberInput>? inputs, string reason, HttpContext context, CancellationToken ct)
    {
        if (machine.Owner != owner?.Trim() || machine.Stage != stage)
        {
            EquipmentEvent(db, context, machine.Id, null, "MachineStageOwnerChanged", reason,
                new { before = new { machine.Owner, machine.Stage }, after = new { owner = owner?.Trim(), stage } });
            machine.Owner = owner?.Trim(); machine.Stage = stage;
        }
        if (inputs is null) return;
        var chambers = await db.MachineChambers.Where(x => x.MachineId == machine.Id).ToListAsync(ct);
        foreach (var input in inputs)
        {
            var chamber = chambers.SingleOrDefault(x => x.Number == input.Number);
            if (chamber is null)
            {
                chamber = new() { Id = Guid.NewGuid(), MachineId = machine.Id, Number = input.Number, Stage = input.Stage, Installed = true };
                db.MachineChambers.Add(chamber);
                EquipmentEvent(db, context, machine.Id, input.Number, "ChamberInstalled", reason, new { stage = input.Stage });
            }
            else if (!chamber.Installed || chamber.Stage != input.Stage)
            {
                EquipmentEvent(db, context, machine.Id, input.Number, chamber.Installed ? "ChamberStageChanged" : "ChamberInstalled", reason,
                    new { before = chamber.Stage, after = input.Stage });
                chamber.Installed = true; chamber.Stage = input.Stage;
            }
        }
        foreach (var chamber in chambers.Where(x => x.Installed && !inputs.Any(input => input.Number == x.Number)))
        {
            chamber.Installed = false;
            var removal = EquipmentEvent(db, context, machine.Id, chamber.Number, "ChamberRemoved", reason, new { chamber.Stage });
            var facts = await db.MachineChamberVersions.Where(x => x.ChamberId == chamber.Id).ToListAsync(ct);
            foreach (var last in facts.GroupBy(x => x.ComponentId).Select(x => x.MaxBy(y => y.Sequence)!).Where(x => x.VersionId != null))
                db.MachineChamberVersions.Add(new() { Id = Guid.NewGuid(), ChamberId = chamber.Id, ComponentId = last.ComponentId, VersionId = null, Sequence = last.Sequence + 1, HistoryId = removal.Id });
        }
    }

    private static async Task<IResult> ChangeMachineEquipmentAsync(Guid machineId, MachineEquipmentRequest request, string action, int? number, HttpContext context, IDbContextFactory<ConfigHubDbContext> factory, CancellationToken ct)
    {
        if (action == "delete" ? !context.User.IsInRole("Admin") && !context.User.IsInRole("SuperAdmin")
            : !context.User.IsInRole("Engineer") && !context.User.IsInRole("SeniorEngineer") && !context.User.IsInRole("Admin") && !context.User.IsInRole("SuperAdmin")) return Results.Forbid();
        var validation = ValidateRequired(request.Reason, "操作原因", 500) ?? ValidateEquipment(request.Owner, request.Stage, request.Chambers);
        if (validation is not null) return Results.ValidationProblem(validation);
        if (action == "equipment" && (request.Stage is null || request.Chambers is null)) return Results.BadRequest(new { message = "请选择整机阶段和腔室组合。" });
        var key = context.Request.Headers["Idempotency-Key"].FirstOrDefault();
        if (string.IsNullOrWhiteSpace(key) || key.Length > 200) return Results.BadRequest(new { message = "必须提供有效幂等键。" });
        await using var db = await factory.CreateDbContextAsync(ct);
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var machine = await db.Machines.FromSqlInterpolated($"SELECT * FROM machines WHERE id = {machineId} FOR UPDATE").IgnoreQueryFilters().SingleOrDefaultAsync(ct);
        if (machine is null) return Results.NotFound();
        if (!await HasProjectWriteAccessAsync(db, context, machine.ProjectId, ct)) return Results.Forbid();
        var scope = $"machine-equipment:{machineId}:{action}:{number}";
        var hash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(request))));
        var replay = await db.IdempotencyRecords.SingleOrDefaultAsync(x => x.Scope == scope && x.IdempotencyKey == key, ct);
        if (replay is not null) return replay.RequestHash == hash && replay.Result is not null ? Results.Ok(replay.Result.RootElement.Clone()) : Results.Conflict(new { message = "幂等键已用于其他操作。" });
        if (machine.DeletedAt is not null) return Results.NotFound();
        if (action == "delete")
        {
            machine.DeletedAt = DateTimeOffset.UtcNow;
            EquipmentEvent(db, context, machineId, null, "MachineDeleted", request.Reason!, new { machine.Name, machine.SerialNumber });
        }
        else if (action == "equipment")
            await ApplyEquipmentAsync(db, machine, request.Owner, request.Stage, request.Chambers, request.Reason!, context, ct);
        else
        {
            var chamber = await db.MachineChambers.SingleOrDefaultAsync(x => x.MachineId == machineId && x.Number == number && x.Installed, ct);
            if (chamber is null) return Results.BadRequest(new { message = "只能为已安装的腔室登记特例。" });
            if (request.Items is null || request.Items.Count > 500 || request.Items.Select(x => x.ComponentId).Distinct().Count() != request.Items.Count)
                return Results.BadRequest(new { message = "请选择不重复的组件与版本；空列表表示全部恢复沿用整机。" });
            var ids = request.Items.Select(x => x.VersionId).ToArray();
            var versions = await db.ComponentVersions.Where(x => ids.Contains(x.Id)).ToDictionaryAsync(x => x.Id, ct);
            var components = await db.ConfigurationComponents.Where(x => x.ProjectId == machine.ProjectId).Select(x => x.Id).ToListAsync(ct);
            if (request.Items.Any(x => !components.Contains(x.ComponentId) || !versions.TryGetValue(x.VersionId, out var v) || v.ComponentId != x.ComponentId))
                return Results.BadRequest(new { message = "组件必须属于机台项目，版本必须属于所选组件。" });
            var facts = await db.MachineChamberVersions.Where(x => x.ChamberId == chamber.Id).ToListAsync(ct);
            var current = facts.GroupBy(x => x.ComponentId).ToDictionary(x => x.Key, x => x.MaxBy(y => y.Sequence)!);
            var history = EquipmentEvent(db, context, machineId, number, "ChamberOverridesChanged", request.Reason!, new { items = request.Items });
            var sequence = facts.Count == 0 ? 1 : facts.Max(x => x.Sequence) + 1;
            foreach (var componentId in current.Keys.Union(request.Items.Select(x => x.ComponentId)))
            {
                var next = request.Items.SingleOrDefault(x => x.ComponentId == componentId)?.VersionId;
                if (current.GetValueOrDefault(componentId)?.VersionId == next) continue;
                db.MachineChamberVersions.Add(new() { Id = Guid.NewGuid(), ChamberId = chamber.Id, ComponentId = componentId, VersionId = next, Sequence = sequence, HistoryId = history.Id });
            }
        }
        var now = DateTimeOffset.UtcNow;
        db.IdempotencyRecords.Add(new() { Id = Guid.NewGuid(), Scope = scope, IdempotencyKey = key, RequestHash = hash, CreatedAt = now, ExpiresAt = now.AddDays(7), Status = IdempotencyRecordStatus.Completed, Result = JsonSerializer.SerializeToDocument(new { id = machineId }) });
        await db.SaveChangesAsync(ct); await tx.CommitAsync(ct);
        return Results.Ok(new { id = machineId });
    }

    private static async Task<IResult> GetMachineEquipmentAsync(Guid machineId, IDbContextFactory<ConfigHubDbContext> factory, CancellationToken ct)
    {
        await using var db = await factory.CreateDbContextAsync(ct);
        var machine = await db.Machines.AsNoTracking().SingleOrDefaultAsync(x => x.Id == machineId, ct);
        if (machine is null) return Results.NotFound();
        var chambers = await db.MachineChambers.AsNoTracking().Where(x => x.MachineId == machineId).OrderBy(x => x.Number).ToListAsync(ct);
        var chamberIds = chambers.Select(x => x.Id).ToArray();
        var facts = await db.MachineChamberVersions.AsNoTracking().Where(x => chamberIds.Contains(x.ChamberId)).OrderByDescending(x => x.Sequence).ToListAsync(ct);
        var versions = await db.ComponentVersions.AsNoTracking().Where(x => db.ConfigurationComponents.Any(c => c.Id == x.ComponentId && c.ProjectId == machine.ProjectId)).ToDictionaryAsync(x => x.Id, ct);
        var components = await db.ConfigurationComponents.AsNoTracking().Where(x => x.ProjectId == machine.ProjectId).ToDictionaryAsync(x => x.Id, ct);
        var target = await db.MachineTargetAssignments.AsNoTracking().SingleOrDefaultAsync(x => x.MachineId == machineId && x.ValidTo == null, ct);
        var items = target is null ? [] : await db.BaselineItems.AsNoTracking().Where(x => x.ConfigurationBaselineId == target.ConfigurationBaselineId).ToListAsync(ct);
        var history = await db.MachineEquipmentHistory.AsNoTracking().Where(x => x.MachineId == machineId).OrderByDescending(x => x.RecordedAt).ToListAsync(ct);
        return Results.Ok(new
        {
            machine.Owner, machine.Stage, targetBaselineId = target?.ConfigurationBaselineId,
            chambers = chambers.Select(chamber => new
            {
                chamber.Number, chamber.Stage, chamber.Installed,
                overrides = facts.Where(x => x.ChamberId == chamber.Id).GroupBy(x => x.ComponentId).Select(x => x.First()).Where(x => x.VersionId != null).Select(x =>
                {
                    var version = versions[x.VersionId!.Value];
                    var expected = items.SingleOrDefault(i => i.ConfigurationComponentId == x.ComponentId)?.ComponentVersionId;
                    return new { x.ComponentId, x.VersionId, componentName = components[x.ComponentId].Name, versionNumber = version.VersionNumber,
                        expectedVersionNumber = expected is not null ? versions.GetValueOrDefault(expected.Value)?.VersionNumber : null,
                        match = target is null ? "Unknown" : expected == x.VersionId ? "Matched" : expected is null ? "Extra" : "Mismatch",
                        risk = version.Safety == VersionSafety.Blocked ? "Critical" : "None" };
                })
            }),
            history = history.Select(x => new { x.Id, x.ChamberNumber, x.Kind, x.Actor, x.Reason, x.RecordedAt, details = x.Details.RootElement.Clone() })
        });
    }
}

public sealed record ChamberInput(int Number, string Stage);
public sealed record ChamberVersionInput(Guid ComponentId, Guid VersionId);
public sealed record MachineEquipmentRequest(string? Reason, string? Owner = null, string? Stage = null, List<ChamberInput>? Chambers = null, List<ChamberVersionInput>? Items = null);
