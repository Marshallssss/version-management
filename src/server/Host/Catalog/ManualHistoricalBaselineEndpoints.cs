using ConfigHub.Infrastructure.ExcelImport;
using ConfigHub.Infrastructure.Persistence;
using ConfigHub.Infrastructure.Persistence.Entities;
using Microsoft.EntityFrameworkCore;

namespace ConfigHub.Host.Catalog;

public static partial class CatalogEndpoints
{
    private const string ManualHistoricalImportKind = "ManualHistory.v1";
    private sealed record ManualHistoricalItem(Guid ComponentId, string? VersionNumber, bool NotConfigured);
    private sealed record ManualHistoricalRequest(string? BaselineName, string? ReleasedAt, string? Reason, List<ManualHistoricalItem>? Items);
    private sealed record ManualHistoricalData(string Kind, List<MatrixComponent> Components, MatrixInputRow Row,
        string Fingerprint, List<HistoricalPreviewRecord> Records);

    private static Task<IResult> PreviewManualHistoricalBaselineAsync(Guid projectId, ManualHistoricalRequest request,
        HttpContext context, IDbContextFactory<ConfigHubDbContext> factory, CancellationToken ct) => MatrixResult(async () =>
    {
        if (ValidateRequired(request.Reason, "补录原因", 500) is { } error) return Results.ValidationProblem(error);
        if (request.Items is null || request.Items.Count == 0 || request.Items.Any(x => x is null))
            throw new ArgumentException("请填写完整的项目组件版本。");
        var reason = request.Reason!.Trim();
        if (reason.Contains('\0')) throw new ArgumentException("补录原因包含无效字符，请重新填写。");
        var key = MatrixKey(context);
        var actor = MatrixActor(context);
        await using var db = await factory.CreateDbContextAsync(ct);
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        if (await db.Projects.FromSqlInterpolated($"SELECT * FROM projects WHERE id = {projectId} FOR UPDATE").SingleOrDefaultAsync(ct) is null) return Results.NotFound();
        if (!await MatrixImportService.CanImportAsync(db, MatrixUser(context), projectId, ct, true)) return Results.Forbid();
        var scope = $"manual.history.preview:{projectId}";
        var hash = HistoricalBaselineCommands.Hash(request);
        var replay = await db.IdempotencyRecords.SingleOrDefaultAsync(x => x.Scope == scope && x.IdempotencyKey == key, ct);
        if (replay is not null) return replay.RequestHash == hash && replay.Result is not null
            ? Results.Ok(replay.Result.RootElement.Clone()) : Results.Conflict(new { message = "幂等键已用于其他历史基线预览。" });

        var current = await db.ConfigurationComponents.AsNoTracking().Where(x => x.ProjectId == projectId)
            .OrderBy(x => x.SortOrder).ThenBy(x => x.Name).ThenBy(x => x.Id).ToListAsync(ct);
        var componentIds = current.Select(x => x.Id).ToHashSet();
        if (request.Items.Select(x => x.ComponentId).Distinct().Count() != request.Items.Count)
            throw new ArgumentException("组件不能重复，请检查本次补录内容。");
        if (request.Items.Any(x => !componentIds.Contains(x.ComponentId)))
            throw new ArgumentException("补录中包含不属于当前项目的组件，请重新打开补录页面。");
        if (request.Items.Count != current.Count)
            throw new ArgumentException("组件清单不完整，请重新打开补录页面，并填写全部组件版本或明确标记当时未配置。");
        var versioned = (await db.ComponentVersions.AsNoTracking().Where(x => componentIds.Contains(x.ComponentId))
            .Select(x => x.ComponentId).Distinct().ToListAsync(ct)).ToHashSet();
        var parents = current.Where(x => x.ParentComponentId != null).Select(x => x.ParentComponentId!.Value).ToHashSet();
        var components = current.Select(x => new MatrixComponent(x.Id, x.ParentComponentId, x.Name, x.SortOrder,
            !versioned.Contains(x.Id) && parents.Contains(x.Id), null, null)).ToList();
        var selections = request.Items.ToDictionary(x => x.ComponentId);
        var values = new Dictionary<Guid, string>();
        foreach (var component in components)
        {
            var selection = selections[component.ComponentId];
            if (selection.VersionNumber?.Any(char.IsControl) == true)
                throw new ArgumentException($"「{component.ComponentName}」版本号不能包含换行或控制字符。");
            var number = selection.VersionNumber?.Trim();
            if (component.IsCategory)
            {
                if (!string.IsNullOrEmpty(number) || selection.NotConfigured)
                    throw new ArgumentException($"「{component.ComponentName}」是结构分类节点，无需填写版本或标记未配置。");
                continue;
            }
            if (selection.NotConfigured)
            {
                if (!string.IsNullOrEmpty(number)) throw new ArgumentException($"「{component.ComponentName}」不能同时填写版本并标记当时未配置。");
                values.Add(component.ComponentId, HistoricalBaselineCommands.Absent);
                continue;
            }
            if (string.IsNullOrEmpty(number) || number.Length > 160 || number.Any(char.IsControl))
                throw new ArgumentException($"「{component.ComponentName}」请填写有效版本号（最多 160 字），或明确标记当时未配置。");
            if (number == HistoricalBaselineCommands.Absent)
                throw new ArgumentException($"「{component.ComponentName}」请使用“当时未配置”选项，不要把它填写为版本号。");
            values.Add(component.ComponentId, number);
        }
        var row = new MatrixInputRow(Guid.NewGuid().ToString("N"), 1, "", reason, true, values,
            "界面补录", "HistoricalBaseline", request.BaselineName, request.ReleasedAt);
        var records = await HistoricalBaselineCommands.ValidateAsync(db, projectId, null, components, [row], ct);
        var now = DateTimeOffset.UtcNow;
        var batch = new ImportBatch { Id = Guid.NewGuid(), ProjectId = projectId, SourceFileName = "界面历史基线补录",
            CreatedBy = actor.Actor, CreatedAt = now, Reason = reason, Status = ImportBatchStatus.Validated };
        db.ImportBatches.Add(batch);
        db.ImportRows.Add(new() { Id = Guid.NewGuid(), ImportBatchId = batch.Id, RowNumber = 1,
            Payload = MatrixImportService.Document(new ManualHistoricalData(ManualHistoricalImportKind, components, row,
                HistoricalBaselineCommands.Hash(records), records)) });
        var result = MatrixImportService.Document(new { id = batch.Id, records });
        db.IdempotencyRecords.Add(new() { Id = Guid.NewGuid(), Scope = scope, IdempotencyKey = key, RequestHash = hash,
            CreatedAt = now, ExpiresAt = now.AddDays(7), Status = IdempotencyRecordStatus.Completed, Result = result });
        MatrixImportService.Audit(db, actor, "ManualHistoricalBaselinePreviewed", batch.Id,
            new { projectId, source = "ManualUI", reason, name = records[0].Name, publishedAt = records[0].ReleasedAt });
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
        return Results.Ok(result.RootElement.Clone());
    });

    private static Task<IResult> CommitManualHistoricalBaselineAsync(Guid projectId, Guid batchId, MatrixReason request,
        HttpContext context, IDbContextFactory<ConfigHubDbContext> factory, CancellationToken ct) => MatrixResult(async () =>
    {
        if (ValidateRequired(request.Reason, "确认原因", 500) is { } error) return Results.ValidationProblem(error);
        var reason = request.Reason!.Trim();
        if (reason.Contains('\0')) throw new ArgumentException("确认原因包含无效字符，请重新填写。");
        var key = MatrixKey(context);
        var actor = MatrixActor(context);
        await using var db = await factory.CreateDbContextAsync(ct);
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        if (await db.Projects.FromSqlInterpolated($"SELECT * FROM projects WHERE id = {projectId} FOR UPDATE").SingleOrDefaultAsync(ct) is null) return Results.NotFound();
        if (!await MatrixImportService.CanImportAsync(db, MatrixUser(context), projectId, ct, true)) return Results.Forbid();
        var batch = await db.ImportBatches.SingleOrDefaultAsync(x => x.Id == batchId && x.ProjectId == projectId, ct);
        if (batch is null) return Results.NotFound();
        var payload = await db.ImportRows.SingleOrDefaultAsync(x => x.ImportBatchId == batchId, ct);
        if (payload is null || !payload.Payload.RootElement.TryGetProperty("kind", out var kind)
            || kind.GetString() != ManualHistoricalImportKind) return Results.NotFound();
        var data = MatrixImportService.Read<ManualHistoricalData>(payload.Payload);
        var scope = $"manual.history.commit:{batchId}";
        var hash = HistoricalBaselineCommands.Hash(request);
        var replay = await db.IdempotencyRecords.SingleOrDefaultAsync(x => x.Scope == scope && x.IdempotencyKey == key, ct);
        if (replay is not null) return replay.RequestHash == hash && replay.Result is not null
            ? Results.Ok(replay.Result.RootElement.Clone()) : Results.Conflict(new { message = "幂等键已用于其他历史基线确认。" });
        if (batch.Status == ImportBatchStatus.Committed) return Results.Ok(new { id = batchId, records = data.Records });
        if (batch.Status != ImportBatchStatus.Validated) return Results.Conflict(new { message = "预览不可提交，请重新预览。" });
        await db.ConfigurationComponents.FromSqlInterpolated($"SELECT * FROM configuration_components WHERE project_id = {projectId} ORDER BY id FOR UPDATE").ToListAsync(ct);
        await db.ComponentVersions.FromSqlInterpolated($"SELECT v.* FROM component_versions v JOIN configuration_components c ON c.id=v.component_id WHERE c.project_id={projectId} ORDER BY v.id FOR UPDATE OF v").ToListAsync(ct);
        var records = await HistoricalBaselineCommands.ValidateAsync(db, projectId, null, data.Components, [data.Row], ct);
        if (HistoricalBaselineCommands.Hash(records) != data.Fingerprint)
            return Results.Conflict(new { message = "版本或组件信息已变化，请重新预览确认，未录入任何历史基线。" });
        var record = records.Single();
        var baselineId = await HistoricalBaselineCommands.ExecuteAsync(db, MatrixUser(context), projectId, null, data.Row, record, actor, ct);
        var committed = new List<HistoricalPreviewRecord> { record with { Imported = true, BaselineId = baselineId } };
        batch.Status = ImportBatchStatus.Committed;
        payload.Payload = MatrixImportService.Document(data with { Records = committed });
        var result = MatrixImportService.Document(new { id = batchId, records = committed });
        var now = DateTimeOffset.UtcNow;
        db.IdempotencyRecords.Add(new() { Id = Guid.NewGuid(), Scope = scope, IdempotencyKey = key, RequestHash = hash,
            CreatedAt = now, ExpiresAt = now.AddDays(7), Status = IdempotencyRecordStatus.Completed, Result = result });
        MatrixImportService.Audit(db, actor, "ManualHistoricalBaselineCommitted", batchId,
            new { projectId, source = "ManualUI", reason, baselineId, publishedAt = record.ReleasedAt });
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
        return Results.Ok(result.RootElement.Clone());
    });
}
