using ConfigHub.Infrastructure.ExcelImport;
using ConfigHub.Infrastructure.Persistence;
using ConfigHub.Infrastructure.Persistence.Entities;
using Microsoft.EntityFrameworkCore;

namespace ConfigHub.Host.Catalog;

public static partial class CatalogEndpoints
{
    private const string HistoricalImportKind = "MatrixHistory.v1";
    private sealed record HistoricalImportData(string Kind, Guid TemplateId, List<MatrixInputRow> Rows, string Fingerprint, List<HistoricalPreviewRecord> Records);

    private static Task<IResult> PreviewHistoricalWorkbookAsync(Guid projectId, MatrixScanRequest request, HttpContext context, IDbContextFactory<ConfigHubDbContext> factory, CancellationToken ct) => MatrixResult(async () =>
    {
        if (ValidateRequired(request.Reason, "补录原因", 500) is { } error) return Results.ValidationProblem(error);
        if (string.IsNullOrWhiteSpace(request.ContentBase64) || request.ContentBase64.Length > 14 * 1024 * 1024 || string.IsNullOrWhiteSpace(request.FileName) || request.FileName.Length > 200 || !request.FileName.EndsWith(".xlsx", StringComparison.OrdinalIgnoreCase)) throw new ArgumentException("请选择不超过 10 MiB 的项目 .xlsx 文件，文件名最多 200 字。");
        var key = MatrixKey(context); var actor = MatrixActor(context);
        await using var db = await factory.CreateDbContextAsync(ct);
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        if (await db.Projects.FromSqlInterpolated($"SELECT * FROM projects WHERE id = {projectId} FOR UPDATE").SingleOrDefaultAsync(ct) is null) return Results.NotFound();
        if (!await MatrixImportService.CanImportAsync(db, MatrixUser(context), projectId, ct, true)) return Results.Forbid();
        var hash = HistoricalBaselineCommands.Hash(request); var scope = $"matrix.history.preview:{projectId}";
        var replay = await db.IdempotencyRecords.SingleOrDefaultAsync(x => x.Scope == scope && x.IdempotencyKey == key, ct);
        if (replay is not null) return replay.RequestHash == hash && replay.Result is not null ? Results.Ok(replay.Result.RootElement.Clone()) : Results.Conflict(new { message = "幂等键已用于其他预览。" });
        var template = await db.MatrixImportTemplates.SingleOrDefaultAsync(x => x.Id == request.TemplateId && x.ProjectId == projectId, ct);
        if (template is null) return Results.NotFound();
        var components = MatrixImportService.Read<List<MatrixComponent>>(template.Components);
        var rows = MatrixWorkbook.Read(Convert.FromBase64String(request.ContentBase64), template.Id, components);
        var historical = rows.Where(x => x.RecordType == "HistoricalBaseline").ToList();
        if (historical.Count == 0) throw new ArgumentException("文件没有历史基线列，请在新版模板中选择历史基线，或使用测试扫描录入。");
        var records = await HistoricalBaselineCommands.ValidateAsync(db, projectId, template.Id, components, historical, ct);
        var batch = new ImportBatch { Id = Guid.NewGuid(), ProjectId = projectId, SourceFileName = request.FileName, CreatedBy = actor.Actor, CreatedAt = DateTimeOffset.UtcNow, Reason = request.Reason!, Status = ImportBatchStatus.Validated };
        db.ImportBatches.Add(batch);
        db.ImportRows.Add(new() { Id = Guid.NewGuid(), ImportBatchId = batch.Id, RowNumber = 1, Payload = MatrixImportService.Document(new HistoricalImportData(HistoricalImportKind, template.Id, historical, HistoricalBaselineCommands.Hash(records), records)) });
        var result = MatrixImportService.Document(new { id = batch.Id, records, testingRecordCount = rows.Count(x => x.RecordType == "Testing") });
        db.IdempotencyRecords.Add(new() { Id = Guid.NewGuid(), Scope = scope, IdempotencyKey = key, RequestHash = hash, CreatedAt = batch.CreatedAt, ExpiresAt = batch.CreatedAt.AddDays(7), Status = IdempotencyRecordStatus.Completed, Result = result });
        MatrixImportService.Audit(db, actor, "HistoricalBaselinePreviewed", batch.Id, new { projectId, templateId = template.Id, request.Reason, count = records.Count });
        await db.SaveChangesAsync(ct); await tx.CommitAsync(ct);
        return Results.Ok(result.RootElement.Clone());
    });

    private static Task<IResult> CommitHistoricalWorkbookAsync(Guid projectId, Guid batchId, MatrixReason request, HttpContext context, IDbContextFactory<ConfigHubDbContext> factory, CancellationToken ct) => MatrixResult(async () =>
    {
        if (ValidateRequired(request.Reason, "确认原因", 500) is { } error) return Results.ValidationProblem(error);
        var key = MatrixKey(context); var actor = MatrixActor(context);
        await using var db = await factory.CreateDbContextAsync(ct);
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        if (await db.Projects.FromSqlInterpolated($"SELECT * FROM projects WHERE id = {projectId} FOR UPDATE").SingleOrDefaultAsync(ct) is null) return Results.NotFound();
        if (!await MatrixImportService.CanImportAsync(db, MatrixUser(context), projectId, ct, true)) return Results.Forbid();
        var batch = await db.ImportBatches.SingleOrDefaultAsync(x => x.Id == batchId && x.ProjectId == projectId, ct);
        if (batch is null) return Results.NotFound();
        var payload = await db.ImportRows.SingleOrDefaultAsync(x => x.ImportBatchId == batchId, ct);
        if (payload is null || !payload.Payload.RootElement.TryGetProperty("kind", out var kind) || kind.GetString() != HistoricalImportKind) return Results.NotFound();
        var data = MatrixImportService.Read<HistoricalImportData>(payload.Payload);
        var scope = $"matrix.history.commit:{batchId}"; var hash = HistoricalBaselineCommands.Hash(request);
        var replay = await db.IdempotencyRecords.SingleOrDefaultAsync(x => x.Scope == scope && x.IdempotencyKey == key, ct);
        if (replay is not null) return replay.RequestHash == hash && replay.Result is not null ? Results.Ok(replay.Result.RootElement.Clone()) : Results.Conflict(new { message = "幂等键已用于其他确认。" });
        if (batch.Status == ImportBatchStatus.Committed) return Results.Ok(new { id = batchId, records = data.Records });
        if (batch.Status != ImportBatchStatus.Validated) return Results.Conflict(new { message = "预览不可提交，请重新预览。" });
        var template = await db.MatrixImportTemplates.SingleAsync(x => x.Id == data.TemplateId && x.ProjectId == projectId, ct);
        await db.ConfigurationComponents.FromSqlInterpolated($"SELECT * FROM configuration_components WHERE project_id = {projectId} ORDER BY id FOR UPDATE").ToListAsync(ct);
        await db.ComponentVersions.FromSqlInterpolated($"SELECT v.* FROM component_versions v JOIN configuration_components c ON c.id=v.component_id WHERE c.project_id={projectId} ORDER BY v.id FOR UPDATE OF v").ToListAsync(ct);
        var validated = await HistoricalBaselineCommands.ValidateAsync(db, projectId, template.Id, MatrixImportService.Read<List<MatrixComponent>>(template.Components), data.Rows, ct);
        if (HistoricalBaselineCommands.Hash(validated) != data.Fingerprint) return Results.Conflict(new { message = "版本或组件信息已变化，请重新预览确认，未录入任何历史基线。" });
        var committed = new List<HistoricalPreviewRecord>();
        var missing = validated.Where(x => !x.Imported).SelectMany(r => r.Items.Where(i => i.WillCreate).Select(i => new { Item = i, r.ReleasedAt, r.Reason }))
            .GroupBy(x => (x.Item.ComponentId, Number: x.Item.VersionNumber!.ToUpperInvariant())).Select(g => g.OrderBy(x => x.ReleasedAt).First()).OrderByDescending(x => x.ReleasedAt);
        foreach (var version in missing)
            await ComponentVersionCommands.RegisterHistoricalAsync(db, version.Item.ComponentId, version.Item.VersionNumber!, version.ReleasedAt, version.Reason, actor, ct);
        foreach (var record in validated.OrderBy(x => x.ReleasedAt))
        {
            var id = await HistoricalBaselineCommands.ExecuteAsync(db, MatrixUser(context), projectId, template.Id, data.Rows.Single(x => x.RowKey == record.RowKey), record, actor, ct);
            committed.Add(record with { Imported = true, BaselineId = id });
        }
        batch.Status = ImportBatchStatus.Committed;
        payload.Payload = MatrixImportService.Document(data with { Records = committed });
        var result = MatrixImportService.Document(new { id = batchId, records = committed });
        db.IdempotencyRecords.Add(new() { Id = Guid.NewGuid(), Scope = scope, IdempotencyKey = key, RequestHash = hash, CreatedAt = DateTimeOffset.UtcNow, ExpiresAt = DateTimeOffset.UtcNow.AddDays(7), Status = IdempotencyRecordStatus.Completed, Result = result });
        MatrixImportService.Audit(db, actor, "HistoricalBaselineBatchCommitted", batchId, new { projectId, request.Reason, baselines = committed.Select(x => x.BaselineId) });
        await db.SaveChangesAsync(ct); await tx.CommitAsync(ct);
        return Results.Ok(result.RootElement.Clone());
    });
}
