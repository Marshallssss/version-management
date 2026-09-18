using System.Text.Json;
using ConfigHub.Infrastructure.Persistence.Entities;
using Microsoft.EntityFrameworkCore;

namespace ConfigHub.Infrastructure.Persistence;

public sealed record VersionWriteContext(string Actor, string CorrelationId);
public sealed record CreateVersionCommandResult(ComponentVersion? Version, bool NotFound, bool Duplicate);

public static class ComponentVersionCommands
{
    public static async Task<CreateVersionCommandResult> CreateAsync(ConfigHubDbContext database, Guid componentId,
        string versionNumber, string reason, VersionWriteContext context, CancellationToken cancellationToken,
        VersionMaturity maturity = VersionMaturity.Draft)
    {
        if (string.IsNullOrWhiteSpace(versionNumber) || versionNumber.Trim().Length > 160 || string.IsNullOrWhiteSpace(reason) || reason.Trim().Length > 500)
            throw new ArgumentException("版本号为必填项且最多 160 字，登记原因最多 500 字且不能为空。");
        if (string.IsNullOrWhiteSpace(context.Actor) || string.IsNullOrWhiteSpace(context.CorrelationId))
            throw new ArgumentException("版本登记必须携带操作者及请求标识。");
        var component = await database.ConfigurationComponents.SingleOrDefaultAsync(x => x.Id == componentId, cancellationToken);
        if (component is null) return new(null, true, false);
        var normalized = versionNumber.Trim().ToUpperInvariant();
        if (database.ComponentVersions.Local.Any(x => x.ComponentId == componentId && x.NormalizedVersionNumber == normalized)
            || await database.ComponentVersions.AnyAsync(x => x.ComponentId == componentId && x.NormalizedVersionNumber == normalized, cancellationToken))
            return new(null, false, true);
        var persistedMax = await database.ComponentVersions.Where(x => x.ComponentId == componentId).Select(x => (long?)x.SequenceNo).MaxAsync(cancellationToken) ?? 0;
        var localMax = database.ComponentVersions.Local.Where(x => x.ComponentId == componentId).Select(x => x.SequenceNo).DefaultIfEmpty().Max();
        var now = DateTimeOffset.UtcNow;
        var version = new ComponentVersion { Id = Guid.NewGuid(), ComponentId = componentId, VersionNumber = versionNumber.Trim(), NormalizedVersionNumber = normalized, SequenceNo = Math.Max(persistedMax, localMax) + 10, Maturity = maturity, CreatedAt = now };
        if (maturity == VersionMaturity.Testing)
        {
            var previous = await database.ComponentVersions.Where(x => x.ComponentId == componentId && x.Maturity == VersionMaturity.Testing).ToListAsync(cancellationToken);
            foreach (var old in previous.Concat(database.ComponentVersions.Local.Where(x => x.ComponentId == componentId && x.Maturity == VersionMaturity.Testing)).DistinctBy(x => x.Id))
            {
                if (old.Maturity != VersionMaturity.Testing) continue;
                old.Maturity = VersionMaturity.Deprecated;
                database.VersionLifecycleTransitions.Add(new() { Id = Guid.NewGuid(), ComponentVersionId = old.Id, Axis = LifecycleAxis.Maturity, FromState = "Testing", ToState = "Deprecated", Reason = reason.Trim(), Actor = context.Actor, OccurredAt = now });
                Audit(database, context, "VersionMaturityChanged", old.Id, new { from = "Testing", to = "Deprecated", reason, source = "SupersededByNewTestingVersion", retainedVersionId = version.Id });
            }
            // Flush retirement before inserting, preserving the one-testing-version constraint.
            await database.SaveChangesAsync(cancellationToken);
        }
        database.ComponentVersions.Add(version);
        var from = VersionMaturity.Draft;
        foreach (var next in InitialPath(maturity))
        {
            database.VersionLifecycleTransitions.Add(new() { Id = Guid.NewGuid(), ComponentVersionId = version.Id, Axis = LifecycleAxis.Maturity, FromState = from.ToString(), ToState = next.ToString(), Reason = reason.Trim(), Actor = context.Actor, OccurredAt = now });
            from = next;
        }
        Audit(database, context, "ComponentVersionCreated", version.Id, new { version.ComponentId, version.VersionNumber, version.SequenceNo, maturity = maturity.ToString(), reason });
        return new(version, false, false);
    }

    private static IEnumerable<VersionMaturity> InitialPath(VersionMaturity target)
    {
        if (target == VersionMaturity.Draft) yield break;
        if (target == VersionMaturity.Deprecated) { yield return VersionMaturity.Deprecated; yield break; }
        yield return VersionMaturity.Testing;
        if (target == VersionMaturity.Testing) yield break;
        yield return VersionMaturity.Released;
        if (target == VersionMaturity.Released) yield break;
        yield return VersionMaturity.Maintenance;
        if (target == VersionMaturity.Deprecated) yield return VersionMaturity.Deprecated;
    }

    private static void Audit(ConfigHubDbContext db, VersionWriteContext context, string action, Guid id, object data) => db.AuditEvents.Add(new()
    {
        Id = Guid.NewGuid(), Actor = context.Actor[..Math.Min(context.Actor.Length, 160)], CorrelationId = context.CorrelationId[..Math.Min(context.CorrelationId.Length, 128)],
        Action = action, EntityType = "ComponentVersion", EntityId = id, Data = JsonDocument.Parse(JsonSerializer.Serialize(data)), OccurredAt = DateTimeOffset.UtcNow
    });
}
