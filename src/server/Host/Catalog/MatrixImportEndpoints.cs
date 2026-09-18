using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using ConfigHub.Infrastructure.ExcelImport;
using ConfigHub.Infrastructure.Persistence;
using ConfigHub.Infrastructure.Persistence.Entities;
using Microsoft.EntityFrameworkCore;

namespace ConfigHub.Host.Catalog;

public static partial class CatalogEndpoints
{
    private static void MapMatrixImportEndpoints(IEndpointRouteBuilder endpoints)
    {
        var group = endpoints.MapGroup("/api/v1/projects/{projectId:guid}/matrix-import").RequireAuthorization();
        group.MapGet("", GetMatrixImportAsync);
        group.MapGet("/combinations/{combinationId:guid}", GetMatrixCombinationAsync);
        group.MapPost("/templates", CreateMatrixTemplateAsync).RequireAuthorization("SeniorEngineer");
        group.MapGet("/templates/{templateId:guid}/download", DownloadMatrixTemplateAsync);
        group.MapPost("/scan", ScanMatrixUploadAsync).RequireAuthorization("SeniorEngineer");
        group.MapPut("/source", SaveMatrixSourceAsync).RequireAuthorization("Admin");
        group.MapPost("/source/scan", ScanMatrixSourceAsync).RequireAuthorization("Admin");
    }

    private static Guid MatrixUser(HttpContext context) => Guid.Parse(context.User.FindFirstValue(ClaimTypes.NameIdentifier)!);
    private static string MatrixKey(HttpContext context)
    {
        var key = context.Request.Headers["Idempotency-Key"].FirstOrDefault();
        if (string.IsNullOrWhiteSpace(key) || key.Length > 200) throw new ArgumentException("请提供有效的幂等键。");
        return key;
    }
    private static VersionWriteContext MatrixActor(HttpContext context) => new(context.User.Identity!.Name!, context.Items["CorrelationId"]?.ToString() ?? context.TraceIdentifier);
    private static async Task<IResult> MatrixResult(Func<Task<IResult>> action)
    {
        try { return await action(); }
        catch (UnauthorizedAccessException) { return Results.Forbid(); }
        catch (KeyNotFoundException error) { return Results.NotFound(new { message = error.Message }); }
        catch (Exception error) when (error is ArgumentException or InvalidDataException or TimeZoneNotFoundException or InvalidTimeZoneException or FormatException)
        { return Results.BadRequest(new { message = error.Message }); }
        catch (IOException) { return Results.Conflict(new { message = "无法读取固定文件，请检查部署电脑的文件路径和读取权限。" }); }
    }

    private static async Task<IResult> GetMatrixImportAsync(Guid projectId, HttpContext context, IDbContextFactory<ConfigHubDbContext> factory, CancellationToken ct)
    {
        await using var db = await factory.CreateDbContextAsync(ct);
        if (!await db.Projects.AnyAsync(x => x.Id == projectId && x.Status == ProjectStatus.Active, ct)) return Results.NotFound();
        var templates = await db.MatrixImportTemplates.AsNoTracking().Where(x => x.ProjectId == projectId).OrderByDescending(x => x.CreatedAt).ToListAsync(ct);
        var sources = await db.MatrixImportSources.AsNoTracking().Where(x => x.ProjectId == projectId).ToListAsync(ct);
        var runs = await db.MatrixImportRuns.AsNoTracking().Where(x => x.ProjectId == projectId).OrderByDescending(x => x.CreatedAt).Take(100).ToListAsync(ct);
        var combinations = await db.MatrixImportCombinations.AsNoTracking().Where(x => x.ProjectId == projectId).OrderByDescending(x => x.CreatedAt).Take(200).ToListAsync(ct);
        var legacyRunIds = runs.Where(run => MatrixImportService.Read<List<MatrixMessage>>(run.Messages)
            .Any(message => message.Level == "info" && message.RowNumber != null && message.CombinationId == null)).Select(run => run.Id).ToArray();
        var ids = combinations.Select(combination => combination.Id).ToArray();
        var legacyCombinations = await db.MatrixImportCombinations.AsNoTracking()
            .Where(combination => legacyRunIds.Contains(combination.RunId) && !ids.Contains(combination.Id)).ToListAsync(ct);
        var views = await MatrixCombinationViewsAsync(db, combinations.Concat(legacyCombinations).ToList(), ct);
        foreach (var run in runs.Where(run => legacyRunIds.Contains(run.Id)))
        {
            var messages = new List<MatrixMessage>();
            foreach (var message in MatrixImportService.Read<List<MatrixMessage>>(run.Messages))
            {
                var combination = message.Level == "info" && message.CombinationId == null
                    ? views.Values.FirstOrDefault(item => item.RunId == run.Id && item.SourceRow == message.RowNumber) : null;
                if (combination is null) { messages.Add(message); continue; }
                var changed = combination.Items.Where(item => item.Changed).ToArray();
                if (changed.Length == 0) messages.Add(message with { Message = "沿用前一套配置，无组件版本变更。", CombinationId = combination.Id, SourceLabel = combination.SourceLabel });
                foreach (var item in changed) messages.Add(new(message.RowNumber, "info",
                    $"{item.ComponentName} 从 {item.PreviousVersionNumber ?? "未指定"} 变为 {item.VersionNumber ?? "未指定"}",
                    combination.Id, item.ComponentId, item.ComponentName, item.PreviousVersionNumber, item.VersionNumber, combination.SourceLabel));
            }
            // Enrich old summaries for display without rewriting persisted import history.
            run.Messages = MatrixImportService.Document(messages);
        }
        return Results.Ok(new
        {
            templates = templates.Select(x => new { x.Id, x.CreatedAt, x.ReferenceBaselineCode, componentCount = MatrixImportService.Read<List<MatrixComponent>>(x.Components).Count(c => !c.IsCategory), components = x.Components.RootElement }),
            sources, runs, combinations = combinations.Select(combination => views[combination.Id])
        });
    }

    private static async Task<IResult> GetMatrixCombinationAsync(Guid projectId, Guid combinationId, IDbContextFactory<ConfigHubDbContext> factory, CancellationToken ct)
    {
        await using var db = await factory.CreateDbContextAsync(ct);
        if (!await db.Projects.AnyAsync(project => project.Id == projectId && project.Status == ProjectStatus.Active, ct)) return Results.NotFound();
        var combination = await db.MatrixImportCombinations.AsNoTracking().SingleOrDefaultAsync(item => item.ProjectId == projectId && item.Id == combinationId, ct);
        if (combination is null) return Results.NotFound();
        var views = await MatrixCombinationViewsAsync(db, [combination], ct);
        return Results.Ok(views[combinationId]);
    }

    private sealed record MatrixCombinationView(Guid Id, Guid ProjectId, Guid TemplateId, Guid RunId, string RowKey,
        int SourceRow, string SourceLabel, long SequenceNo, string ContentHash, string RecordDate, string Reason,
        DateTimeOffset CreatedAt, IReadOnlyList<MatrixComponent> Items);

    private static async Task<Dictionary<Guid, MatrixCombinationView>> MatrixCombinationViewsAsync(ConfigHubDbContext db,
        List<MatrixImportCombination> combinations, CancellationToken ct)
    {
        if (combinations.Count == 0) return [];
        var selectedIds = combinations.Select(item => item.Id).ToArray();
        var templateIds = combinations.Select(item => item.TemplateId).Distinct().ToArray();
        var runIds = combinations.Select(item => item.RunId).Distinct().ToArray();
        var templates = await db.MatrixImportTemplates.AsNoTracking().Where(item => templateIds.Contains(item.Id)).ToDictionaryAsync(item => item.Id, ct);
        var previous = await db.MatrixImportCombinations.AsNoTracking().Where(candidate => db.MatrixImportCombinations.Any(current =>
            selectedIds.Contains(current.Id) && current.TemplateId == candidate.TemplateId && current.SequenceNo == candidate.SequenceNo + 1)).ToListAsync(ct);
        var previousItems = previous.ToDictionary(item => (item.TemplateId, item.SequenceNo), item => MatrixImportService.Read<List<MatrixComponent>>(item.Items));
        var runs = await db.MatrixImportRuns.AsNoTracking().Where(item => runIds.Contains(item.Id)).ToListAsync(ct);
        var messages = runs.ToDictionary(item => item.Id, item => MatrixImportService.Read<List<MatrixMessage>>(item.Messages));
        var frozen = combinations.ToDictionary(item => item.Id, item => MatrixImportService.Read<List<MatrixComponent>>(item.Items));
        var versionIds = frozen.Values.SelectMany(items => items).Where(item => item.VersionId != null).Select(item => item.VersionId!.Value).Distinct().ToArray();
        var available = (await db.ComponentVersions.AsNoTracking().Where(version => versionIds.Contains(version.Id)).Select(version => version.Id).ToListAsync(ct)).ToHashSet();
        return combinations.ToDictionary(combination => combination.Id, combination =>
        {
            var before = (previousItems.GetValueOrDefault((combination.TemplateId, combination.SequenceNo - 1))
                ?? MatrixImportService.Read<List<MatrixComponent>>(templates[combination.TemplateId].Components)).ToDictionary(item => item.ComponentId);
            var items = frozen[combination.Id].Select(item => item with
            {
                PreviousVersionId = before.GetValueOrDefault(item.ComponentId)?.VersionId,
                PreviousVersionNumber = before.GetValueOrDefault(item.ComponentId)?.VersionNumber,
                VersionAvailable = item.VersionId == null || available.Contains(item.VersionId.Value)
            }).ToArray();
            var label = messages.GetValueOrDefault(combination.RunId)?.FirstOrDefault(message => message.CombinationId == combination.Id)?.SourceLabel
                ?? $"第 {combination.SourceRow} 行";
            return new MatrixCombinationView(combination.Id, combination.ProjectId, combination.TemplateId, combination.RunId, combination.RowKey,
                combination.SourceRow, label, combination.SequenceNo, combination.ContentHash, combination.RecordDate, combination.Reason, combination.CreatedAt, items);
        });
    }

    private static Task<IResult> CreateMatrixTemplateAsync(Guid projectId, MatrixReason request, HttpContext context, IDbContextFactory<ConfigHubDbContext> factory, CancellationToken ct) => MatrixResult(async () =>
    {
        if (ValidateRequired(request.Reason, "生成原因", 500) is { } error) return Results.ValidationProblem(error);
        var key = MatrixKey(context);
        await using var db = await factory.CreateDbContextAsync(ct);
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var project = await db.Projects.FromSqlInterpolated($"SELECT * FROM projects WHERE id = {projectId} FOR UPDATE").SingleOrDefaultAsync(ct);
        if (project is null) return Results.NotFound();
        if (!await MatrixImportService.CanImportAsync(db, MatrixUser(context), projectId, ct)) return Results.Forbid();
        var scope = $"matrix.template:{projectId}";
        var hash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(request.Reason!)));
        var replay = await db.IdempotencyRecords.SingleOrDefaultAsync(x => x.Scope == scope && x.IdempotencyKey == key, ct);
        if (replay is not null) return replay.RequestHash == hash && replay.Result is not null ? Results.Ok(replay.Result.RootElement.Clone()) : Results.Conflict(new { message = "幂等键已用于其他模板。" });
        var all = await db.ConfigurationComponents.AsNoTracking().Where(x => x.ProjectId == projectId).ToListAsync(ct);
        var ordered = new List<ConfigurationComponent>();
        void Visit(Guid? parent) { foreach (var component in all.Where(x => x.ParentComponentId == parent).OrderBy(x => x.SortOrder).ThenBy(x => x.Name)) { ordered.Add(component); Visit(component.Id); } }
        Visit(null);
        var ids = all.Select(x => x.Id).ToArray();
        var versioned = await db.ComponentVersions.Where(x => ids.Contains(x.ComponentId)).Select(x => x.ComponentId).Distinct().ToListAsync(ct);
        var standard = await db.ProjectStandardAssignments.Where(x => x.ProjectId == projectId && x.ValidTo == null).Select(x => (Guid?)x.ConfigurationBaselineId).SingleOrDefaultAsync(ct);
        var baseline = standard is Guid standardId ? await db.ConfigurationBaselines.AsNoTracking().SingleAsync(x => x.Id == standardId, ct) : null;
        var reference = standard is Guid bid ? await db.BaselineItems.AsNoTracking().Where(x => x.ConfigurationBaselineId == bid).ToDictionaryAsync(x => x.ConfigurationComponentId, ct) : [];
        var components = ordered.Select(x => new MatrixComponent(x.Id, x.ParentComponentId, x.Name, x.SortOrder, !versioned.Contains(x.Id) && all.Any(c => c.ParentComponentId == x.Id), reference.GetValueOrDefault(x.Id)?.ComponentVersionId, reference.GetValueOrDefault(x.Id)?.VersionNumberSnapshot)).ToList();
        if (components.Count(x => !x.IsCategory) is 0 or > 496) return Results.BadRequest(new { message = "模板需要 1 至 496 个可登记版本的组件。请先建立项目组件。" });
        var template = new MatrixImportTemplate { Id = Guid.NewGuid(), ProjectId = projectId, CreatedAt = DateTimeOffset.UtcNow, CreatedBy = context.User.Identity!.Name!, ReferenceBaselineCode = baseline?.BaselineCode, Components = MatrixImportService.Document(components) };
        db.MatrixImportTemplates.Add(template);
        foreach (var item in components) db.MatrixImportReferences.Add(new() { Id = Guid.NewGuid(), TemplateId = template.Id, ComponentId = item.ComponentId, VersionId = item.VersionId });
        var result = MatrixImportService.Document(new { id = template.Id, downloadUrl = $"/api/v1/projects/{projectId}/matrix-import/templates/{template.Id}/download" });
        MatrixImportService.Audit(db, MatrixActor(context), "MatrixTemplateCreated", template.Id, new { projectId, request.Reason, template.ReferenceBaselineCode });
        db.IdempotencyRecords.Add(new() { Id = Guid.NewGuid(), Scope = scope, IdempotencyKey = key, RequestHash = hash, CreatedAt = template.CreatedAt, ExpiresAt = template.CreatedAt.AddDays(7), Status = IdempotencyRecordStatus.Completed, Result = result });
        await db.SaveChangesAsync(ct); await tx.CommitAsync(ct);
        return Results.Ok(result.RootElement.Clone());
    });

    private static Task<IResult> DownloadMatrixTemplateAsync(Guid projectId, Guid templateId, IDbContextFactory<ConfigHubDbContext> factory, CancellationToken ct) => MatrixResult(async () =>
    {
        await using var db = await factory.CreateDbContextAsync(ct);
        var project = await db.Projects.AsNoTracking().SingleOrDefaultAsync(x => x.Id == projectId && x.Status == ProjectStatus.Active, ct);
        var template = await db.MatrixImportTemplates.AsNoTracking().SingleOrDefaultAsync(x => x.Id == templateId && x.ProjectId == projectId, ct);
        if (project is null || template is null) return Results.NotFound();
        return Results.File(MatrixWorkbook.Create(template.Id, project.Name, MatrixImportService.Read<List<MatrixComponent>>(template.Components), template.ReferenceBaselineCode ?? "无参考基线"), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "project-version-template.xlsx");
    });

    private static Task<IResult> ScanMatrixUploadAsync(Guid projectId, MatrixScanRequest request, HttpContext context, IDbContextFactory<ConfigHubDbContext> factory, CancellationToken ct) => MatrixResult(async () =>
    {
        if (ValidateRequired(request.Reason, "扫描原因", 500) is { } error) return Results.ValidationProblem(error);
        if (string.IsNullOrWhiteSpace(request.ContentBase64) || request.ContentBase64.Length > MatrixWorkbook.MaximumBytes * 4 / 3 + 8 || string.IsNullOrWhiteSpace(request.FileName) || !request.FileName.EndsWith(".xlsx", StringComparison.OrdinalIgnoreCase)) return Results.BadRequest(new { message = "请选择不超过 10 MiB 的 .xlsx 项目模板。" });
        var actor = MatrixActor(context);
        return Results.Ok(await MatrixImportService.ScanAsync(factory, projectId, request.TemplateId, MatrixUser(context), actor.Actor, actor.CorrelationId, MatrixKey(context), request.Reason!, request.FileName, Convert.FromBase64String(request.ContentBase64), null, ct));
    });

    private static Task<IResult> SaveMatrixSourceAsync(Guid projectId, MatrixSourceRequest request, HttpContext context, IDbContextFactory<ConfigHubDbContext> factory, CancellationToken ct) => MatrixResult(async () =>
    {
        if (ValidateRequired(request.Reason, "设置原因", 500) is { } error) return Results.ValidationProblem(error);
        var key = MatrixKey(context);
        var next = MatrixImportService.NextScan(request.LocalTime, request.TimeZoneId, DateTimeOffset.UtcNow);
        await using var db = await factory.CreateDbContextAsync(ct);
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        await db.Projects.FromSqlInterpolated($"SELECT * FROM projects WHERE id = {projectId} FOR UPDATE").SingleOrDefaultAsync(ct);
        if (!await MatrixImportService.CanImportAsync(db, MatrixUser(context), projectId, ct, true)) return Results.Forbid();
        var template = await db.MatrixImportTemplates.SingleOrDefaultAsync(x => x.Id == request.TemplateId && x.ProjectId == projectId, ct);
        if (template is null) return Results.NotFound();
        var hash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(request))));
        var scope = $"matrix.source:{projectId}";
        var replay = await db.IdempotencyRecords.SingleOrDefaultAsync(x => x.Scope == scope && x.IdempotencyKey == key, ct);
        if (replay is not null) return replay.RequestHash == hash && replay.Result is not null ? Results.Ok(replay.Result.RootElement.Clone()) : Results.Conflict(new { message = "幂等键已用于其他设置。" });
        var filePath = request.Path?.Trim() ?? "";
        if (filePath.Length > 2000) return Results.BadRequest(new { message = "文件路径过长。" });
        var source = await db.MatrixImportSources.SingleOrDefaultAsync(x => x.ProjectId == projectId, ct);
        if (request.Enabled || source is null || source.Path != filePath || source.TemplateId != template.Id)
            MatrixWorkbook.Read(await MatrixImportService.ReadStableFileAsync(filePath, ct), template.Id, MatrixImportService.Read<List<MatrixComponent>>(template.Components));
        source ??= new() { Id = Guid.NewGuid(), ProjectId = projectId, TemplateId = template.Id, Path = filePath, LocalTime = request.LocalTime, TimeZoneId = request.TimeZoneId, LastStatus = "Pending" };
        source.TemplateId = template.Id; source.Path = filePath; source.LocalTime = request.LocalTime; source.TimeZoneId = request.TimeZoneId; source.Enabled = request.Enabled; source.AuthorizedByUserId = MatrixUser(context); source.NextScanAt = next;
        if (db.Entry(source).State == EntityState.Detached) db.MatrixImportSources.Add(source);
        MatrixImportService.Audit(db, MatrixActor(context), "MatrixSourceConfigured", source.Id, new { projectId, source.TemplateId, source.Path, source.LocalTime, source.TimeZoneId, source.Enabled, request.Reason });
        db.IdempotencyRecords.Add(new() { Id = Guid.NewGuid(), Scope = scope, IdempotencyKey = key, RequestHash = hash, CreatedAt = DateTimeOffset.UtcNow, ExpiresAt = DateTimeOffset.UtcNow.AddDays(7), Status = IdempotencyRecordStatus.Completed, Result = MatrixImportService.Document(source) });
        await db.SaveChangesAsync(ct); await tx.CommitAsync(ct);
        return Results.Ok(source);
    });

    private static Task<IResult> ScanMatrixSourceAsync(Guid projectId, MatrixReason request, HttpContext context, IDbContextFactory<ConfigHubDbContext> factory, CancellationToken ct) => MatrixResult(async () =>
    {
        if (ValidateRequired(request.Reason, "扫描原因", 500) is { } error) return Results.ValidationProblem(error);
        await using var db = await factory.CreateDbContextAsync(ct);
        if (!await MatrixImportService.CanImportAsync(db, MatrixUser(context), projectId, ct, true)) return Results.Forbid();
        var source = await db.MatrixImportSources.SingleOrDefaultAsync(x => x.ProjectId == projectId, ct);
        if (source is null) return Results.NotFound();
        var actor = MatrixActor(context);
        return Results.Ok(await MatrixImportService.ScanAsync(factory, projectId, source.TemplateId, source.AuthorizedByUserId, actor.Actor, actor.CorrelationId, MatrixKey(context), request.Reason!, source.Path, null, source.Id, ct));
    });
}

public sealed record MatrixReason(string? Reason);
public sealed record MatrixScanRequest(Guid TemplateId, string ContentBase64, string FileName, string? Reason);
public sealed record MatrixSourceRequest(Guid TemplateId, string Path, string LocalTime, string TimeZoneId, bool Enabled, string? Reason);
