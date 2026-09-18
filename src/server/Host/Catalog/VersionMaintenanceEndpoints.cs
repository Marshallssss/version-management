using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using ConfigHub.Infrastructure.Persistence;
using ConfigHub.Infrastructure.Persistence.Entities;
using Microsoft.EntityFrameworkCore;

namespace ConfigHub.Host.Catalog;

public static partial class CatalogEndpoints
{
    private static async Task<IResult> DeleteVersionAsync(Guid versionId, DeleteVersionRequest request, HttpContext context, IDbContextFactory<ConfigHubDbContext> factory, CancellationToken cancellationToken)
    {
        if (ValidateRequired(request.Reason, "删除原因", 500) is { } error) return Results.ValidationProblem(error);
        var key = context.Request.Headers["Idempotency-Key"].FirstOrDefault();
        if (string.IsNullOrWhiteSpace(key) || key.Length > 200) return Results.BadRequest(new { message = "删除版本需要有效的幂等键。" });
        await using var db = await factory.CreateDbContextAsync(cancellationToken);
        await using var tx = await db.Database.BeginTransactionAsync(cancellationToken);
        if (!await IsCurrentVersionAdministratorAsync(db, context, cancellationToken)) return Results.Forbid();
        var scope = $"versions.delete:{versionId}";
        var hash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(request))));
        var replay = await db.IdempotencyRecords.AsNoTracking().SingleOrDefaultAsync(item => item.Scope == scope && item.IdempotencyKey == key, cancellationToken);
        if (replay is not null) return replay.RequestHash == hash && replay.Result is not null ? Results.Ok(replay.Result.RootElement.Clone()) : Results.Conflict(new { message = "幂等键已用于其他操作。" });
        var version = await db.ComponentVersions.FromSqlInterpolated($"SELECT * FROM component_versions WHERE id = {versionId} FOR UPDATE").SingleOrDefaultAsync(cancellationToken);
        if (version is null)
        {
            // A concurrent retry may have waited for the original deletion to commit.
            replay = await db.IdempotencyRecords.AsNoTracking().SingleOrDefaultAsync(item => item.Scope == scope && item.IdempotencyKey == key, cancellationToken);
            if (replay is not null) return replay.RequestHash == hash && replay.Result is not null ? Results.Ok(replay.Result.RootElement.Clone()) : Results.Conflict(new { message = "幂等键已用于其他操作。" });
            return Results.NotFound();
        }
        if (await db.MachineChamberVersions.AnyAsync(item => item.VersionId == versionId, cancellationToken)
            || await db.LaboratoryValidations.AnyAsync(item => item.ComponentVersionId == versionId, cancellationToken)
            || await db.BaselineItems.AnyAsync(item => item.ComponentVersionId == versionId, cancellationToken)
            || await db.ConfigurationBaselines.AnyAsync(item => item.TopComponentVersionId == versionId, cancellationToken)
            || await db.DeploymentItems.AnyAsync(item => item.NewComponentVersionId == versionId, cancellationToken)
            || await db.MachineCurrentConfigurations.AnyAsync(item => item.ComponentVersionId == versionId, cancellationToken)
            || await db.VersionExposureSnapshots.AnyAsync(item => item.ComponentVersionId == versionId, cancellationToken))
            return Results.Conflict(new { message = "该版本已被基线、机台配置、验证或风险记录引用，不能删除。可将版本标记为已废弃，保留追溯记录。" });
        var importReferences = await db.MatrixImportReferences.Where(item => item.VersionId == versionId).ToListAsync(cancellationToken);
        // Preserve import snapshots and their component references; only detach the live version link.
        foreach (var reference in importReferences) reference.VersionId = null;
        var patches = await db.VersionPatches.Where(item => item.ComponentVersionId == versionId).ToListAsync(cancellationToken);
        var transitions = await db.VersionLifecycleTransitions.Where(item => item.ComponentVersionId == versionId).ToListAsync(cancellationToken);
        var recommendations = await db.VersionRecommendations.Where(item => item.ComponentVersionId == versionId).ToListAsync(cancellationToken);
        db.VersionPatches.RemoveRange(patches);
        db.VersionLifecycleTransitions.RemoveRange(transitions);
        db.VersionRecommendations.RemoveRange(recommendations);
        db.ComponentVersions.Remove(version);
        AddAuditEvent(db, context, "ComponentVersionDeleted", "ComponentVersion", versionId, new { version, patches, transitions, recommendations, retainedImportReferences = importReferences.Select(item => new { item.Id, item.TemplateId, item.CombinationId, item.ComponentId, deletedVersionId = versionId }).ToArray(), reason = request.Reason!.Trim() });
        var result = new { id = versionId, deleted = true, componentId = version.ComponentId };
        var now = DateTimeOffset.UtcNow;
        db.IdempotencyRecords.Add(new IdempotencyRecord { Id = Guid.NewGuid(), Scope = scope, IdempotencyKey = key, RequestHash = hash, CreatedAt = now, ExpiresAt = now.AddDays(7), Status = IdempotencyRecordStatus.Completed, Result = JsonDocument.Parse(JsonSerializer.Serialize(result)) });
        try
        {
            await db.SaveChangesAsync(cancellationToken);
            await tx.CommitAsync(cancellationToken);
            return Results.Ok(result);
        }
        catch (DbUpdateException exception) when (exception.InnerException is Npgsql.PostgresException { SqlState: Npgsql.PostgresErrorCodes.ForeignKeyViolation })
        {
            return Results.Conflict(new { message = "该版本刚被其他记录引用，删除未执行。请刷新后重试。" });
        }
    }

    private static async Task<bool> IsCurrentVersionAdministratorAsync(ConfigHubDbContext db, HttpContext context, CancellationToken cancellationToken)
    {
        if (!Guid.TryParse(context.User.FindFirst(global::System.Security.Claims.ClaimTypes.NameIdentifier)?.Value, out var userId)) return false;
        return await (from user in db.Users
            join membership in db.UserRoles on user.Id equals membership.UserId
            join role in db.Roles on membership.RoleId equals role.Id
            where user.Id == userId && (user.LockoutEnd == null || user.LockoutEnd <= DateTimeOffset.UtcNow)
                && (role.Name == "Admin" || role.Name == "SuperAdmin")
            select user.Id).AnyAsync(cancellationToken);
    }

    private static async Task<bool> HasCurrentVersionLifecycleAccessAsync(ConfigHubDbContext db, HttpContext context, Guid projectId, CancellationToken cancellationToken)
    {
        if (await IsCurrentVersionAdministratorAsync(db, context, cancellationToken)) return true;
        if (!Guid.TryParse(context.User.FindFirst(global::System.Security.Claims.ClaimTypes.NameIdentifier)?.Value, out var userId)) return false;
        return await (from user in db.Users
            join membership in db.UserRoles on user.Id equals membership.UserId
            join role in db.Roles on membership.RoleId equals role.Id
            where user.Id == userId && (user.LockoutEnd == null || user.LockoutEnd <= DateTimeOffset.UtcNow)
                && role.Name == "SeniorEngineer"
                && db.ProjectMemberships.Any(item => item.ProjectId == projectId && item.UserId == userId && item.Role == ProjectMembershipRole.SeniorEngineer)
            select user.Id).AnyAsync(cancellationToken);
    }

    private static async Task<IResult> ManageVersionPatchAsync(Guid patchId, ManagePatchRequest request, HttpContext context, IDbContextFactory<ConfigHubDbContext> factory, CancellationToken cancellationToken)
    {
        if (ValidateRequired(request.Reason, "操作原因", 500) is { } error) return Results.ValidationProblem(error);
        if (request.Action is not ("withdraw" or "delete")) return Results.BadRequest(new { message = "请选择撤回或删除。" });
        if (request.Action == "delete" && !context.User.IsInRole("Admin") && !context.User.IsInRole("SuperAdmin")) return Results.Forbid();
        var key = context.Request.Headers["Idempotency-Key"].FirstOrDefault();
        if (string.IsNullOrWhiteSpace(key) || key.Length > 200) return Results.BadRequest(new { message = "操作需要有效的幂等键。" });
        await using var db = await factory.CreateDbContextAsync(cancellationToken);
        await using var tx = await db.Database.BeginTransactionAsync(cancellationToken);
        var scope = $"patches.manage:{patchId}";
        var hash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(request))));
        var replay = await db.IdempotencyRecords.SingleOrDefaultAsync(item => item.Scope == scope && item.IdempotencyKey == key, cancellationToken);
        if (replay is not null) return replay.RequestHash == hash && replay.Result is not null ? Results.Ok(replay.Result.RootElement.Clone()) : Results.Conflict(new { message = "幂等键已用于其他操作。" });
        var patch = await db.VersionPatches.FromSqlInterpolated($"SELECT * FROM version_patches WHERE id = {patchId} FOR UPDATE").SingleOrDefaultAsync(cancellationToken);
        if (patch is null) return Results.NotFound();
        var projectId = await db.ComponentVersions.Where(v => v.Id == patch.ComponentVersionId).Join(db.ConfigurationComponents, v => v.ComponentId, c => c.Id, (v, c) => c.ProjectId).SingleAsync(cancellationToken);
        if (!await HasProjectWriteAccessAsync(db, context, projectId, cancellationToken)) return Results.Forbid();
        if (request.Action == "delete" && patch.Status != VersionPatchStatus.Draft) return Results.Conflict(new { message = "只能删除草稿补丁；已发布补丁请撤回以保留历史。" });
        if (request.Action == "withdraw" && patch.Status != VersionPatchStatus.Released) return Results.Conflict(new { message = "只有已发布补丁可以撤回。" });
        var before = new { patch.PatchCode, patch.Title, patch.IssueDescription, patch.ResolutionDescription, status = patch.Status.ToString(), patch.RecordedAt, patch.RecordedBy };
        if (request.Action == "delete") db.VersionPatches.Remove(patch); else patch.Status = VersionPatchStatus.Withdrawn;
        var result = new { id = patch.Id, deleted = request.Action == "delete", status = patch.Status.ToString() };
        AddAuditEvent(db, context, request.Action == "delete" ? "VersionPatchDeleted" : "VersionPatchWithdrawn", "VersionPatch", patch.Id, new { before, request.Reason });
        var now = DateTimeOffset.UtcNow;
        db.IdempotencyRecords.Add(new IdempotencyRecord { Id = Guid.NewGuid(), Scope = scope, IdempotencyKey = key, RequestHash = hash, CreatedAt = now, ExpiresAt = now.AddDays(7), Status = IdempotencyRecordStatus.Completed, Result = JsonDocument.Parse(JsonSerializer.Serialize(result)) });
        await db.SaveChangesAsync(cancellationToken);
        await tx.CommitAsync(cancellationToken);
        return Results.Ok(result);
    }

    private static async Task<IResult> MaintainVersionAsync(Guid versionId, MaintainVersionRequest request, HttpContext context, IConfiguration configuration, IDbContextFactory<ConfigHubDbContext> factory, CancellationToken cancellationToken)
    {
        if (!configuration.GetValue<bool>("ConfigHub:TestDataMaintenanceEnabled")) return Results.Conflict(new { message = "调测维护已关闭。" });
        if (!request.MaintenanceMode) return Results.BadRequest(new { message = "必须明确开启调测维护。" });
        var error = ValidateRequired(request.VersionNumber, "版本号", 160) ?? ValidateRequired(request.Reason, "维护原因", 500);
        if (error is not null) return Results.ValidationProblem(error);
        if (!Enum.TryParse<VersionMaturity>(request.Maturity, out var maturity) || !Enum.IsDefined(maturity)) return Results.BadRequest(new { message = "无效的成熟度。" });
        if (request.CreatedAt.Year < 2000 || request.CreatedAt > DateTimeOffset.UtcNow) return Results.BadRequest(new { message = "登记时间必须在 2000 年至现在之间。" });
        if (request.ReleasedAt is not null && (request.ReleasedAt < request.CreatedAt || request.ReleasedAt > DateTimeOffset.UtcNow)) return Results.BadRequest(new { message = "发布时间必须在登记时间至现在之间。" });
        var key = context.Request.Headers["Idempotency-Key"].FirstOrDefault();
        if (string.IsNullOrWhiteSpace(key) || key.Length > 200) return Results.BadRequest(new { message = "维护需要有效的幂等键。" });
        await using var db = await factory.CreateDbContextAsync(cancellationToken);
        await using var tx = await db.Database.BeginTransactionAsync(cancellationToken);
        var scope = $"versions.maintenance:{versionId}";
        var hash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(request))));
        var replay = await db.IdempotencyRecords.SingleOrDefaultAsync(item => item.Scope == scope && item.IdempotencyKey == key, cancellationToken);
        if (replay is not null) return replay.RequestHash == hash && replay.Result is not null ? Results.Ok(replay.Result.RootElement.Clone()) : Results.Conflict(new { message = "幂等键已用于其他操作。" });
        var version = await db.ComponentVersions.FromSqlInterpolated($"SELECT * FROM component_versions WHERE id = {versionId} FOR UPDATE").SingleOrDefaultAsync(cancellationToken);
        if (version is null) return Results.NotFound();
        if (maturity is VersionMaturity.Released or VersionMaturity.Maintenance
            && version.Maturity is not (VersionMaturity.Released or VersionMaturity.Maintenance)
            && await ValidateLaboratoryReleaseAsync(db, context, [versionId], cancellationToken) is { } laboratoryError)
            return Results.Conflict(new { message = laboratoryError });
        var normalized = Normalize(request.VersionNumber!);
        if (await db.ComponentVersions.AnyAsync(v => v.ComponentId == version.ComponentId && v.Id != versionId && v.NormalizedVersionNumber == normalized, cancellationToken)) return Results.Conflict(new { message = "该组件已登记相同版本号。" });
        if (maturity == VersionMaturity.Testing && await db.ComponentVersions.AnyAsync(v => v.ComponentId == version.ComponentId && v.Id != versionId && v.Maturity == VersionMaturity.Testing, cancellationToken)) return Results.Conflict(new { message = "该组件已有测试版本，请先处理现有测试版本。" });
        var releaseTransition = await db.VersionLifecycleTransitions.Where(t => t.ComponentVersionId == versionId && t.Axis == LifecycleAxis.Maturity && t.ToState == "Released").OrderByDescending(t => t.OccurredAt).FirstOrDefaultAsync(cancellationToken);
        if (request.ReleasedAt is not null && releaseTransition is null && maturity != VersionMaturity.Released) return Results.Conflict(new { message = "此版本没有发布记录，请先选择已发布状态。" });
        var before = new { version.VersionNumber, version.CreatedAt, maturity = version.Maturity.ToString(), releasedAt = releaseTransition?.OccurredAt };
        var now = DateTimeOffset.UtcNow;
        if (request.ReleasedAt is not null && releaseTransition is not null && (maturity != VersionMaturity.Released || version.Maturity == maturity)) releaseTransition.OccurredAt = request.ReleasedAt.Value;
        if (version.Maturity != maturity) db.VersionLifecycleTransitions.Add(new VersionLifecycleTransition { Id = Guid.NewGuid(), ComponentVersionId = versionId, Axis = LifecycleAxis.Maturity, FromState = version.Maturity.ToString(), ToState = maturity.ToString(), Actor = context.User.Identity!.Name!, Reason = request.Reason!.Trim(), OccurredAt = maturity == VersionMaturity.Released ? request.ReleasedAt ?? now : now });
        version.VersionNumber = request.VersionNumber!.Trim();
        version.NormalizedVersionNumber = normalized;
        version.CreatedAt = request.CreatedAt;
        version.Maturity = maturity;
        if (maturity is not VersionMaturity.Released and not VersionMaturity.Maintenance)
        {
            var recommendations = await db.VersionRecommendations.Where(item => item.ComponentVersionId == versionId && item.RevokedAt == null).ToListAsync(cancellationToken);
            foreach (var recommendation in recommendations)
            {
                recommendation.RevokedAt = now;
                recommendation.RevokedBy = context.User.Identity!.Name!;
                recommendation.RevokeReason = request.Reason!.Trim();
            }
        }
        var result = new { id = version.Id, version.VersionNumber, version.CreatedAt, maturity = maturity.ToString(), releasedAt = request.ReleasedAt ?? releaseTransition?.OccurredAt };
        AddAuditEvent(db, context, "VersionTestDataMaintained", "ComponentVersion", version.Id, new { before, after = result, request.Reason });
        db.IdempotencyRecords.Add(new IdempotencyRecord { Id = Guid.NewGuid(), Scope = scope, IdempotencyKey = key, RequestHash = hash, CreatedAt = now, ExpiresAt = now.AddDays(7), Status = IdempotencyRecordStatus.Completed, Result = JsonDocument.Parse(JsonSerializer.Serialize(result)) });
        await db.SaveChangesAsync(cancellationToken);
        await tx.CommitAsync(cancellationToken);
        return Results.Ok(result);
    }
}

public sealed record ManagePatchRequest(string Action, string? Reason);
public sealed record DeleteVersionRequest(string? Reason);
public sealed record MaintainVersionRequest(string? VersionNumber, string Maturity, DateTimeOffset CreatedAt, string? Reason, bool MaintenanceMode, DateTimeOffset? ReleasedAt = null);
