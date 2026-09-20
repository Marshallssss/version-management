using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using ConfigHub.Infrastructure.Persistence;
using ConfigHub.Infrastructure.Persistence.Entities;
using Microsoft.EntityFrameworkCore;

namespace ConfigHub.Host.Catalog;

public static partial class CatalogEndpoints
{
    private static async Task<IResult> UpdateProjectAsync(Guid projectId, CreateProjectRequest request, HttpContext context, IDbContextFactory<ConfigHubDbContext> factory, CancellationToken ct)
    {
        var validation = ValidateIdentifier(request.Code, "项目编码", 50, allowSpace: true)
            ?? ValidateRequired(request.Name, "项目名称", 200) ?? ValidateRequired(request.Reason, "修改原因", 500);
        if (validation is not null) return Results.ValidationProblem(validation);
        if (request.Description?.Length > 2000) return Results.BadRequest(new { message = "项目说明不能超过 2000 字。" });
        var key = context.Request.Headers["Idempotency-Key"].FirstOrDefault();
        if (string.IsNullOrWhiteSpace(key) || key.Length > 200) return Results.BadRequest(new { message = "请提供有效幂等键。" });
        await using var db = await factory.CreateDbContextAsync(ct);
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var project = await db.Projects.FromSqlInterpolated($"SELECT * FROM projects WHERE id = {projectId} FOR UPDATE").SingleOrDefaultAsync(ct);
        if (project is null) return Results.NotFound();
        if (!await HasProjectWriteAccessAsync(db, context, projectId, ct)) return Results.Forbid();
        var scope = $"projects.update:{projectId}";
        var hash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(request))));
        var replay = await db.IdempotencyRecords.SingleOrDefaultAsync(item => item.Scope == scope && item.IdempotencyKey == key, ct);
        if (replay is not null) return replay.RequestHash == hash && replay.Result is not null ? Results.Ok(replay.Result.RootElement.Clone()) : Results.Conflict(new { message = "幂等键已用于其他修改。" });
        var normalized = Normalize(request.Code!);
        if (await db.Projects.AnyAsync(item => item.Id != projectId && item.NormalizedCode == normalized, ct)) return Results.Conflict(new { message = "项目编码已存在。" });
        var before = new { project.Code, project.Name, project.Description };
        project.Code = request.Code!.Trim(); project.NormalizedCode = normalized;
        project.Name = request.Name!.Trim(); project.Description = NormalizeOptional(request.Description, 2000);
        project.UpdatedAt = DateTimeOffset.UtcNow;
        AddAuditEvent(db, context, "ProjectUpdated", "Project", projectId, new { before, after = new { project.Code, project.Name, project.Description }, reason = request.Reason!.Trim() });
        var result = JsonSerializer.SerializeToDocument(new { id = projectId });
        db.IdempotencyRecords.Add(new() { Id = Guid.NewGuid(), Scope = scope, IdempotencyKey = key, RequestHash = hash, Status = IdempotencyRecordStatus.Completed, Result = result, CreatedAt = project.UpdatedAt, ExpiresAt = project.UpdatedAt.AddDays(7) });
        try { await db.SaveChangesAsync(ct); await tx.CommitAsync(ct); }
        catch (DbUpdateException error) when (error.InnerException is Npgsql.PostgresException { SqlState: "23505" }) { return Results.Conflict(new { message = "项目编码已存在，请刷新后重试。" }); }
        return Results.Ok(result.RootElement.Clone());
    }

    private static async Task<IResult> RenameBaselineAsync(Guid baselineId, RenameBaselineRequest request, HttpContext context, IDbContextFactory<ConfigHubDbContext> factory, CancellationToken ct)
    {
        var validation = ValidateRequired(request.Name, "基线名称", 100) ?? ValidateRequired(request.Reason, "修改原因", 500);
        if (validation is not null) return Results.ValidationProblem(validation);
        var key = context.Request.Headers["Idempotency-Key"].FirstOrDefault();
        if (string.IsNullOrWhiteSpace(key) || key.Length > 200) return Results.BadRequest(new { message = "请提供有效幂等键。" });
        await using var db = await factory.CreateDbContextAsync(ct);
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        if (!await IsCurrentVersionAdministratorAsync(db, context, ct)) return Results.Forbid();
        var baseline = await db.ConfigurationBaselines.FromSqlInterpolated($"SELECT * FROM configuration_baselines WHERE id = {baselineId} FOR UPDATE").SingleOrDefaultAsync(ct);
        if (baseline is null) return Results.NotFound();
        var scope = $"baselines.rename:{baselineId}";
        var hash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(request))));
        var replay = await db.IdempotencyRecords.SingleOrDefaultAsync(item => item.Scope == scope && item.IdempotencyKey == key, ct);
        if (replay is not null) return replay.RequestHash == hash && replay.Result is not null ? Results.Ok(replay.Result.RootElement.Clone()) : Results.Conflict(new { message = "幂等键已用于其他修改。" });
        var normalized = Normalize(request.Name!);
        if (await db.ConfigurationBaselines.AnyAsync(item => item.ProjectId == baseline.ProjectId && item.Id != baselineId && item.NormalizedBaselineCode == normalized, ct)) return Results.Conflict(new { message = "本项目已有同名基线。" });
        var before = baseline.BaselineCode;
        baseline.BaselineCode = request.Name!.Trim(); baseline.NormalizedBaselineCode = normalized;
        // The database permits only these two name columns, never snapshot or release metadata.
        await db.Database.ExecuteSqlRawAsync("SET LOCAL confighub.baseline_rename = 'on'", ct);
        AddAuditEvent(db, context, "BaselineRenamed", "ConfigurationBaseline", baselineId, new { before, after = baseline.BaselineCode, reason = request.Reason!.Trim() });
        var now = DateTimeOffset.UtcNow;
        var result = JsonSerializer.SerializeToDocument(new { id = baselineId, name = baseline.BaselineCode });
        db.IdempotencyRecords.Add(new() { Id = Guid.NewGuid(), Scope = scope, IdempotencyKey = key, RequestHash = hash, Status = IdempotencyRecordStatus.Completed, Result = result, CreatedAt = now, ExpiresAt = now.AddDays(7) });
        try { await db.SaveChangesAsync(ct); await tx.CommitAsync(ct); }
        catch (DbUpdateException error) when (error.InnerException is Npgsql.PostgresException { SqlState: "23505" }) { return Results.Conflict(new { message = "本项目已有同名基线。" }); }
        return Results.Ok(result.RootElement.Clone());
    }
}

public sealed record RenameBaselineRequest(string? Name, string? Reason);
