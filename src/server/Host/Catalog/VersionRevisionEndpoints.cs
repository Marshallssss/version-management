using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using ConfigHub.Infrastructure.Persistence;
using ConfigHub.Infrastructure.Persistence.Entities;
using Microsoft.EntityFrameworkCore;

namespace ConfigHub.Host.Catalog;

public static partial class CatalogEndpoints
{
    private sealed record PublishRevisionRequest(Guid[]? PatchIds, string? Reason);
    private sealed record RevisionPatch(Guid Id, string PatchCode, string Title, string IssueDescription, string ResolutionDescription);

    private static async Task<IResult> ListVersionRevisionsAsync(Guid versionId, IDbContextFactory<ConfigHubDbContext> factory, CancellationToken ct)
    {
        await using var db = await factory.CreateDbContextAsync(ct);
        if (!await db.ComponentVersions.IgnoreQueryFilters().AnyAsync(x => x.Id == versionId, ct)) return Results.NotFound();
        return Results.Ok(await db.ComponentVersionRevisions.AsNoTracking().Where(x => x.ComponentVersionId == versionId)
            .OrderBy(x => x.RevisionNo).ToListAsync(ct));
    }

    private static async Task<IResult> PublishVersionRevisionAsync(Guid versionId, PublishRevisionRequest request, HttpContext context,
        IDbContextFactory<ConfigHubDbContext> factory, CancellationToken ct)
    {
        if (ValidateRequired(request.Reason, "发布原因", 500) is { } error) return Results.ValidationProblem(error);
        if (request.PatchIds is null || request.PatchIds.Length > 200 || request.PatchIds.Distinct().Count() != request.PatchIds.Length)
            return Results.BadRequest(new { message = "请选择不重复的补丁，最多 200 项。" });
        var key = context.Request.Headers["Idempotency-Key"].FirstOrDefault();
        if (string.IsNullOrWhiteSpace(key) || key.Length > 200) return Results.BadRequest(new { message = "发布修订需要有效幂等键。" });
        await using var db = await factory.CreateDbContextAsync(ct);
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var version = await db.ComponentVersions.FromSqlInterpolated($"SELECT * FROM component_versions WHERE id={versionId} FOR UPDATE").SingleOrDefaultAsync(ct);
        if (version is null) return Results.NotFound();
        var projectId = await db.ConfigurationComponents.Where(x => x.Id == version.ComponentId).Select(x => x.ProjectId).SingleAsync(ct);
        if (!await HasCurrentVersionLifecycleAccessAsync(db, context, projectId, ct)) return Results.Forbid();
        var scope = $"version-revisions.publish:{versionId}";
        var hash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(new { patches = request.PatchIds.Order(), reason = request.Reason!.Trim() }))));
        var replay = await db.IdempotencyRecords.SingleOrDefaultAsync(x => x.Scope == scope && x.IdempotencyKey == key, ct);
        if (replay is not null) return replay.RequestHash == hash && replay.Result is not null ? Results.Ok(replay.Result.RootElement.Clone()) : Results.Conflict(new { message = "幂等键已用于不同请求。" });
        if (version.Maturity is not (VersionMaturity.Released or VersionMaturity.Maintenance) || version.Safety == VersionSafety.Blocked)
            return Results.Conflict(new { message = "只有未阻断的已发布或维护中版本可以发布修订。" });
        var prior = await db.ComponentVersionRevisions.Where(x => x.ComponentVersionId == versionId).OrderBy(x => x.RevisionNo).ToListAsync(ct);
        var latest = prior.LastOrDefault();
        var inherited = latest?.Patches.Deserialize<RevisionPatch[]>() ?? [];
        if (inherited.Any(x => !request.PatchIds.Contains(x.Id))) return Results.Conflict(new { message = "累计修订必须包含上一修订的全部补丁。" });
        var additions = request.PatchIds.Except(inherited.Select(x => x.Id)).ToArray();
        var patches = await db.VersionPatches.Where(x => additions.Contains(x.Id) && x.ComponentVersionId == versionId && x.Status == VersionPatchStatus.Released)
            .OrderBy(x => x.RecordedAt).ThenBy(x => x.Id).Select(x => new RevisionPatch(x.Id, x.PatchCode, x.Title, x.IssueDescription, x.ResolutionDescription)).ToArrayAsync(ct);
        if (patches.Length != additions.Length) return Results.BadRequest(new { message = "新增补丁必须属于本版本且已发布。" });
        if (latest is not null && additions.Length == 0) return Results.Conflict(new { message = "补丁集合没有变化，无需重复发布修订。" });
        var now = DateTimeOffset.UtcNow;
        ComponentVersionRevision NewRevision(int number, RevisionPatch[] snapshot) => new()
        {
            Id = Guid.NewGuid(), ComponentVersionId = versionId, RevisionNo = number, Patches = JsonSerializer.SerializeToDocument(snapshot),
            Reason = request.Reason!.Trim(), Actor = context.User.Identity!.Name!, CorrelationId = context.Items["CorrelationId"]?.ToString() ?? context.TraceIdentifier, CreatedAt = now
        };
        var original = prior.FirstOrDefault() ?? NewRevision(0, []);
        if (prior.Count == 0) db.ComponentVersionRevisions.Add(original);
        var revision = request.PatchIds.Length == 0 ? original : NewRevision((latest?.RevisionNo ?? 0) + 1, [.. inherited, .. patches]);
        if (revision != original) db.ComponentVersionRevisions.Add(revision);
        AddAuditEvent(db, context, "ComponentVersionRevisionPublished", "ComponentVersion", versionId,
            new { revisionId = revision.Id, revision.RevisionNo, patchIds = request.PatchIds, reason = request.Reason!.Trim() });
        var result = new { id = revision.Id, revision.RevisionNo };
        db.IdempotencyRecords.Add(new() { Id = Guid.NewGuid(), Scope = scope, IdempotencyKey = key, RequestHash = hash, CreatedAt = now, ExpiresAt = now.AddDays(7), Status = IdempotencyRecordStatus.Completed, Result = JsonSerializer.SerializeToDocument(result) });
        await db.SaveChangesAsync(ct); await tx.CommitAsync(ct);
        return Results.Ok(result);
    }
}
