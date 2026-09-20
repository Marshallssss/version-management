using System.Globalization;
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
    private const string MachineImportKind = "MachineWorkbook.v1";
    private sealed record MachineUpload(string FileName, string ContentBase64, string Reason);
    private sealed record MachineImportData(string Kind, string[] Values, CreateMachineRequest Create,
        Guid? BaselineId, List<RecordFactItem> Snapshot, DateTimeOffset? RecordedAt, string? Warning,
        Guid? MachineId = null, bool Completed = false, string? Error = null);

    private static void MapMachineImportEndpoints(IEndpointRouteBuilder endpoints)
    {
        var group = endpoints.MapGroup("/api/v1/projects/{projectId:guid}/machine-import").RequireAuthorization("SeniorEngineer");
        group.MapGet("/template", DownloadMachineTemplateAsync);
        group.MapPost("/preview", PreviewMachineWorkbookAsync);
        group.MapGet("/batches", ListMachineImportsAsync);
        group.MapGet("/batches/{batchId:guid}", GetMachineImportAsync);
        group.MapPost("/batches/{batchId:guid}/commit", CommitMachineWorkbookAsync);
    }

    private static async Task<IResult> DownloadMachineTemplateAsync(Guid projectId, HttpContext context, IDbContextFactory<ConfigHubDbContext> factory, CancellationToken ct)
    {
        await using var db = await factory.CreateDbContextAsync(ct);
        if (!await HasProjectWriteAccessAsync(db, context, projectId, ct, requireSeniorMembership: true)) return Results.Forbid();
        var project = await db.Projects.SingleOrDefaultAsync(item => item.Id == projectId, ct);
        return project is null ? Results.NotFound() : Results.File(MachineWorkbook.Create(projectId, project.Name), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "machine-template.xlsx");
    }

    private static Task<IResult> PreviewMachineWorkbookAsync(Guid projectId, MachineUpload request, HttpContext context, IDbContextFactory<ConfigHubDbContext> factory, CancellationToken ct) => MatrixResult(async () =>
    {
        if (ValidateRequired(request.Reason, "导入原因", 500) is { } error) return Results.ValidationProblem(error);
        if (string.IsNullOrWhiteSpace(request.FileName) || request.FileName.Length > 200 || !request.FileName.EndsWith(".xlsx", StringComparison.OrdinalIgnoreCase)) throw new ArgumentException("请选择 .xlsx 机台模板，文件名最多 200 字。");
        if (request.ContentBase64 is null || request.ContentBase64.Length > 14 * 1024 * 1024) throw new ArgumentException("文件不能超过 10 MB。");
        var key = MatrixKey(context);
        await using var db = await factory.CreateDbContextAsync(ct);
        if (!await HasProjectWriteAccessAsync(db, context, projectId, ct, requireSeniorMembership: true)) return Results.Forbid();
        var rows = MachineWorkbook.Read(Convert.FromBase64String(request.ContentBase64), projectId);
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        // Serialize staging within this project, including retries with the same key.
        if (await db.Projects.FromSqlInterpolated($"SELECT * FROM projects WHERE id = {projectId} FOR UPDATE").SingleOrDefaultAsync(ct) is null) return Results.NotFound();
        var scope = $"machine-import.preview:{projectId}";
        var hash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(request))));
        var replay = await db.IdempotencyRecords.SingleOrDefaultAsync(item => item.Scope == scope && item.IdempotencyKey == key, ct);
        if (replay is not null) return replay.RequestHash == hash && replay.Result is not null ? Results.Ok(replay.Result.RootElement.Clone()) : Results.Conflict(new { message = "此幂等键已用于另一文件。" });
        var serials = rows.Select(row => Normalize(row.Values[0])).ToArray();
        var duplicates = serials.GroupBy(x => x).Where(group => group.Count() > 1).Select(group => group.Key).ToHashSet();
        var existing = (await db.Machines.IgnoreQueryFilters().Where(item => serials.Contains(item.NormalizedSerialNumber)).Select(item => item.NormalizedSerialNumber).ToListAsync(ct)).ToHashSet();
        var baselines = await db.ConfigurationBaselines.AsNoTracking().Where(item => item.ProjectId == projectId && item.State == BaselineState.Released).ToListAsync(ct);
        var now = DateTimeOffset.UtcNow;
        var batch = new ImportBatch { Id = Guid.NewGuid(), ProjectId = projectId, SourceFileName = request.FileName, Reason = request.Reason.Trim(), CreatedBy = context.User.Identity!.Name!, CreatedAt = now, Status = ImportBatchStatus.Validated };
        db.ImportBatches.Add(batch);
        foreach (var row in rows)
        {
            var v = row.Values;
            var errors = new List<string>();
            var status = v[7] switch { "" or "在用" => "Active", "短期 CIP" => "ShortTermCip", "长期 CIP" => "LongTermCip", "暂未过货" => "NoProduction", "已归档" => "Archived", _ => "Invalid" };
            DateTimeOffset? resume = null;
            if (v[8].Length > 0)
            {
                if (DateTime.TryParseExact(v[8], "yyyy-MM-dd HH:mm", CultureInfo.InvariantCulture, DateTimeStyles.None, out var local)) resume = new DateTimeOffset(local, TimeSpan.FromHours(8)).ToUniversalTime();
                else errors.Add("预计恢复时间须为 YYYY-MM-DD HH:mm（北京时间）");
            }
            if (status == "Invalid") errors.Add("状态不合法");
            if (status is "ShortTermCip" or "LongTermCip" && resume is null) errors.Add("CIP 必须填写预计恢复时间");
            var chambers = Enumerable.Range(1, 6).Where(number => v[number + 9].Length > 0).Select(number => new ChamberInput(number, v[number + 9])).ToList();
            var create = new CreateMachineRequest(projectId, v[0], v[1], v[2], v[3], v[18], v[4], v[9].Length == 0 ? "Lab" : v[9], chambers, v[5], v[6], status, resume);
            var validation = ValidateRequired(v[0], "序列号", 160) ?? ValidateRequired(v[1], "机台名称", 200) ?? ValidateRequired(v[18], "录入原因", 500) ?? ValidateEquipment(create.Owner, create.Stage, chambers);
            if (validation is not null) errors.AddRange(validation.Values.SelectMany(x => x));
            if (v[2].Length > 120 || v[3].Length > 200 || v[5].Length > 200 || v[6].Length > 1000) errors.Add("机型最多 120 字，位置/工艺最多 200 字，配置最多 1000 字");
            if (duplicates.Contains(Normalize(v[0]))) errors.Add("文件内序列号重复");
            if (existing.Contains(Normalize(v[0]))) errors.Add("序列号已存在（含历史机台），不会覆盖");
            var baseline = baselines.SingleOrDefault(item => item.NormalizedBaselineCode == Normalize(v[16]));
            string? warning = v[16].Length > 0 && baseline is null ? $"基线“{v[16]}”无法匹配本项目已发布基线；机台仍可导入，软件版本留空。" : null;
            DateTimeOffset? observed = null;
            if (baseline is not null)
            {
                if (!DateTime.TryParseExact(v[17], "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var date) || new DateTimeOffset(date, TimeSpan.FromHours(8)) > now) errors.Add("匹配基线后须填写不晚于今天的配置记录日期：YYYY-MM-DD");
                else observed = new DateTimeOffset(date, TimeSpan.FromHours(8)).ToUniversalTime();
            }
            var snapshot = baseline is null ? [] : await db.BaselineItems.AsNoTracking().Where(item => item.ConfigurationBaselineId == baseline.Id && item.ComponentVersionId != null).OrderBy(item => item.ConfigurationComponentId).Select(item => new RecordFactItem(item.ConfigurationComponentId, item.ComponentVersionId, false, null)).ToListAsync(ct);
            if (baseline is not null && snapshot.Count == 0) { warning = "基线没有可用软件版本；机台仍可导入，软件版本留空。"; baseline = null; }
            var payload = new MachineImportData(MachineImportKind, v, create, baseline?.Id, snapshot, observed, warning);
            db.ImportRows.Add(new ImportRow { Id = Guid.NewGuid(), ImportBatchId = batch.Id, RowNumber = row.RowNumber, Payload = JsonSerializer.SerializeToDocument(payload), ValidationError = errors.Count == 0 ? null : string.Join("；", errors) });
            if (errors.Count > 0) batch.Status = ImportBatchStatus.Staged;
        }
        AddAuditEvent(db, context, "MachineImportStaged", "ImportBatch", batch.Id, new { projectId, fileName = request.FileName, rows = rows.Count, reason = request.Reason });
        var result = JsonSerializer.SerializeToDocument(new { id = batch.Id });
        db.IdempotencyRecords.Add(new() { Id = Guid.NewGuid(), Scope = scope, IdempotencyKey = key, RequestHash = hash, Result = result, Status = IdempotencyRecordStatus.Completed, CreatedAt = now, ExpiresAt = now.AddDays(7) });
        await db.SaveChangesAsync(ct); await tx.CommitAsync(ct);
        return Results.Ok(result.RootElement.Clone());
    });

    private static async Task<IResult> ListMachineImportsAsync(Guid projectId, HttpContext context, IDbContextFactory<ConfigHubDbContext> factory, CancellationToken ct)
    {
        await using var db = await factory.CreateDbContextAsync(ct);
        if (!await HasProjectWriteAccessAsync(db, context, projectId, ct, requireSeniorMembership: true)) return Results.Forbid();
        var batches = await db.ImportBatches.AsNoTracking().Where(batch => batch.ProjectId == projectId && db.AuditEvents.Any(a => a.EntityId == batch.Id && a.Action == "MachineImportStaged")).OrderByDescending(batch => batch.CreatedAt).Take(30).Select(batch => new { batch.Id, batch.SourceFileName, batch.CreatedAt, status = batch.Status.ToString() }).ToListAsync(ct);
        return Results.Ok(batches);
    }

    private static async Task<IResult> GetMachineImportAsync(Guid projectId, Guid batchId, HttpContext context, IDbContextFactory<ConfigHubDbContext> factory, CancellationToken ct)
    {
        await using var db = await factory.CreateDbContextAsync(ct);
        if (!await HasProjectWriteAccessAsync(db, context, projectId, ct, requireSeniorMembership: true)) return Results.Forbid();
        var batch = await db.ImportBatches.AsNoTracking().SingleOrDefaultAsync(item => item.Id == batchId && item.ProjectId == projectId, ct);
        if (batch is null) return Results.NotFound();
        var rows = await db.ImportRows.AsNoTracking().Where(item => item.ImportBatchId == batchId).OrderBy(item => item.RowNumber).ToListAsync(ct);
        if (rows.Any(item => !IsMachineImport(item))) return Results.NotFound();
        return Results.Ok(new { batch.Id, batch.SourceFileName, status = batch.Status.ToString(), rows = rows.Select(row => new { row.RowNumber, row.ValidationError, data = row.Payload.Deserialize<MachineImportData>() }) });
    }

    private static bool IsMachineImport(ImportRow row) => row.Payload.RootElement.TryGetProperty("Kind", out var kind) && kind.GetString() == MachineImportKind;

    private static Task<IResult> CommitMachineWorkbookAsync(Guid projectId, Guid batchId, HttpContext context, IDbContextFactory<ConfigHubDbContext> factory, CancellationToken ct) => MatrixResult(async () =>
    {
        _ = MatrixKey(context);
        await using var db = await factory.CreateDbContextAsync(ct);
        if (!await HasProjectWriteAccessAsync(db, context, projectId, ct, requireSeniorMembership: true)) return Results.Forbid();
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var batch = await db.ImportBatches.FromSqlInterpolated($"SELECT * FROM import_batches WHERE id = {batchId} FOR UPDATE").SingleOrDefaultAsync(ct);
        if (batch is null || batch.ProjectId != projectId) return Results.NotFound();
        var rows = await db.ImportRows.Where(item => item.ImportBatchId == batchId).OrderBy(item => item.RowNumber).ToListAsync(ct);
        if (rows.Count == 0 || rows.Any(row => !IsMachineImport(row))) return Results.NotFound();
        if (rows.Any(row => row.ValidationError is not null)) return Results.Conflict(new { message = "机台资料仍有错误，请修改 Excel 后重新检查。基线识别警告不影响提交。" });
        if (batch.Status == ImportBatchStatus.Committed) return Results.Ok(new { id = batchId });
        var originalKey = context.Request.Headers["Idempotency-Key"];
        try
        {
            foreach (var row in rows)
            {
                var data = row.Payload.Deserialize<MachineImportData>()!;
                if (data.Completed) continue;
                // Every write goes through the same command as interactive entry, with stable per-row keys.
                if (data.MachineId is null)
                {
                    context.Request.Headers["Idempotency-Key"] = $"machine-excel:{batchId:N}:{row.Id:N}:create";
                    IResult result;
                    try { result = await CreateMachineAsync(data.Create, context, factory, ct); }
                    catch (DbUpdateException error) when (error.InnerException is Npgsql.PostgresException { SqlState: "23505" }) { result = Results.Conflict(new { message = "序列号已被其他操作登记，请核对。" }); }
                    if ((result as IStatusCodeHttpResult)?.StatusCode is not (>= 200 and < 300))
                    {
                        row.Payload = JsonSerializer.SerializeToDocument(data with { Error = MachineImportError(result) }); continue;
                    }
                    var value = JsonSerializer.SerializeToElement(((IValueHttpResult)result).Value);
                    data = data with { MachineId = value.GetProperty("id").GetGuid() };
                }
                data = data with { Error = null };
                if (data.BaselineId is Guid baselineId)
                {
                    var current = await db.ConfigurationBaselines.AsNoTracking().SingleOrDefaultAsync(item => item.Id == baselineId && item.ProjectId == projectId && item.State == BaselineState.Released, ct);
                    var items = await db.BaselineItems.AsNoTracking().Where(item => item.ConfigurationBaselineId == baselineId && item.ComponentVersionId != null).OrderBy(item => item.ConfigurationComponentId).Select(item => new RecordFactItem(item.ConfigurationComponentId, item.ComponentVersionId, false, null)).ToListAsync(ct);
                    if (current is null || !items.SequenceEqual(data.Snapshot)) data = data with { Warning = "预览后基线已改变或撤回；机台资料已导入，软件版本留空，请手动核对。", BaselineId = null };
                    else
                    {
                        var fact = new RecordFactsRequest("InitialSnapshot", "Full", "machine-excel", row.Id.ToString(), data.RecordedAt, data.Create.Reason, data.Snapshot);
                        var recorded = await RecordFactsCoreAsync(data.MachineId!.Value, fact, context, factory, $"machine-excel:{batchId:N}:{row.Id:N}:snapshot", ct);
                        if ((recorded as IStatusCodeHttpResult)?.StatusCode is not (>= 200 and < 300)) data = data with { Error = "机台资料已保存，配置未写入，可重试：" + MachineImportError(recorded) };
                    }
                }
                data = data with { Completed = data.Error is null };
                row.Payload = JsonSerializer.SerializeToDocument(data);
            }
        }
        finally { context.Request.Headers["Idempotency-Key"] = originalKey; }
        var completed = rows.Count(row => row.Payload.Deserialize<MachineImportData>()!.Completed);
        batch.Status = completed == rows.Count ? ImportBatchStatus.Committed : ImportBatchStatus.Failed;
        AddAuditEvent(db, context, "MachineImportCommitted", "ImportBatch", batchId, new { projectId, completed, failed = rows.Count - completed, reason = batch.Reason });
        await db.SaveChangesAsync(ct); await tx.CommitAsync(ct);
        return Results.Ok(new { id = batchId });
    });

    private static string MachineImportError(IResult result)
    {
        if (result is IValueHttpResult value)
        {
            var json = JsonSerializer.SerializeToElement(value.Value);
            if (json.TryGetProperty("message", out var message)) return message.GetString() ?? "保存失败";
        }
        return $"保存失败（HTTP {(result as IStatusCodeHttpResult)?.StatusCode}），请核对资料和权限后重试。";
    }
}
