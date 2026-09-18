using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using ConfigHub.Infrastructure.Persistence;
using ConfigHub.Infrastructure.Persistence.Entities;
using Microsoft.EntityFrameworkCore;

namespace ConfigHub.Infrastructure.ExcelImport;

public sealed record MatrixMessage(int? RowNumber, string Level, string Message, Guid? CombinationId = null,
    Guid? ComponentId = null, string? ComponentName = null, string? PreviousVersionNumber = null,
    string? VersionNumber = null, string? SourceLabel = null);

public static class MatrixImportService
{
    public static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    public static T Read<T>(JsonDocument document) => document.Deserialize<T>(Json)!;
    public static JsonDocument Document(object value) => JsonSerializer.SerializeToDocument(value, Json);

    public static async Task<bool> CanImportAsync(ConfigHubDbContext db, Guid userId, Guid projectId, CancellationToken ct, bool adminOnly = false)
    {
        if (!await db.Projects.AnyAsync(x => x.Id == projectId && x.Status == ProjectStatus.Active, ct)) return false;
        var user = await db.Users.AsNoTracking().SingleOrDefaultAsync(x => x.Id == userId, ct);
        if (user is null || user.LockoutEnd > DateTimeOffset.UtcNow) return false;
        var roles = await (from membership in db.UserRoles join role in db.Roles on membership.RoleId equals role.Id where membership.UserId == userId select role.Name).ToListAsync(ct);
        if (roles.Contains("Admin") || roles.Contains("SuperAdmin")) return true;
        return !adminOnly && roles.Contains("SeniorEngineer") && await db.ProjectMemberships.AnyAsync(x => x.ProjectId == projectId && x.UserId == userId && x.Role == ProjectMembershipRole.SeniorEngineer, ct);
    }

    public static async Task<MatrixImportRun> ScanAsync(IDbContextFactory<ConfigHubDbContext> factory, Guid projectId, Guid templateId,
        Guid userId, string actor, string correlationId, string key, string reason, string fileName, byte[]? bytes, Guid? sourceId, CancellationToken ct)
    {
        await using var db = await factory.CreateDbContextAsync(ct);
        await using var transaction = await db.Database.BeginTransactionAsync(ct);
        if (await db.Projects.FromSqlInterpolated($"SELECT * FROM projects WHERE id = {projectId} FOR UPDATE").SingleOrDefaultAsync(ct) is null)
            throw new KeyNotFoundException("项目不存在。");
        if (!await CanImportAsync(db, userId, projectId, ct, sourceId != null)) throw new UnauthorizedAccessException("项目测试版本录入权限已失效。");
        var template = await db.MatrixImportTemplates.SingleOrDefaultAsync(x => x.Id == templateId && x.ProjectId == projectId, ct)
            ?? throw new KeyNotFoundException("模板不属于当前项目。");
        var hash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(new { templateId, reason, fileName, sourceId, content = bytes is null ? "" : Convert.ToHexString(SHA256.HashData(bytes)) }))));
        var scope = $"matrix.scan:{projectId}";
        var replay = await db.IdempotencyRecords.SingleOrDefaultAsync(x => x.Scope == scope && x.IdempotencyKey == key, ct);
        if (replay is not null)
        {
            if (replay.RequestHash != hash || replay.Result is null) throw new ArgumentException("幂等键已用于其他扫描。");
            return Read<MatrixImportRun>(replay.Result);
        }
        MatrixImportSource? source = null;
        if (sourceId is Guid id)
        {
            source = await db.MatrixImportSources.SingleOrDefaultAsync(x => x.Id == id && x.ProjectId == projectId && x.TemplateId == templateId, ct)
                ?? throw new KeyNotFoundException("扫描源已经变更，请刷新后重试。");
            if (source.AuthorizedByUserId != userId || !await CanImportAsync(db, source.AuthorizedByUserId, projectId, ct, true)) throw new UnauthorizedAccessException("扫描源授权已失效，请管理员重新保存设置。");
        }
        var run = new MatrixImportRun { Id = Guid.NewGuid(), ProjectId = projectId, TemplateId = templateId, SourceId = sourceId, CreatedAt = DateTimeOffset.UtcNow, FileName = Path.GetFileName(fileName)[..Math.Min(Path.GetFileName(fileName).Length, 260)], Actor = actor, Status = "Succeeded", Messages = Document(Array.Empty<MatrixMessage>()) };
        var messages = new List<MatrixMessage>();
        var retryFile = false;
        await transaction.CreateSavepointAsync("matrix_content", ct);
        try
        {
            if (source is not null) bytes = await ReadStableFileAsync(source.Path, ct);
            var components = Read<List<MatrixComponent>>(template.Components);
            var rows = MatrixWorkbook.Read(bytes ?? throw new InvalidDataException("未收到 Excel 文件。"), templateId, components);
            var currentComponentIds = await db.ConfigurationComponents.Where(x => x.ProjectId == projectId).Select(x => x.Id).ToListAsync(ct);
            if (components.Any(x => !currentComponentIds.Contains(x.ComponentId))) throw new InvalidDataException("模板中的组件已被删除，请重新生成模板。");
            var committed = await db.MatrixImportCombinations.Where(x => x.TemplateId == templateId).OrderBy(x => x.SequenceNo).ToListAsync(ct);
            var knownRows = committed.ToDictionary(x => x.RowKey);
            var preceding = committed.LastOrDefault() is { } last ? Read<List<MatrixComponent>>(last.Items) : components;
            var sequence = committed.LastOrDefault()?.SequenceNo ?? 0;
            var availableVersions = await db.ComponentVersions.Where(v => currentComponentIds.Contains(v.ComponentId)).ToListAsync(ct);
            var writeContext = new VersionWriteContext(actor, correlationId);
            var waiting = false;
            foreach (var row in rows)
            {
                var position = row.SourceLabel ?? $"第 {row.RowNumber} 行";
                var contentHash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(new { row.RecordDate, row.Reason, values = row.Values.OrderBy(x => x.Key) }, Json))));
                if (knownRows.TryGetValue(row.RowKey, out var old))
                {
                    if (old.ContentHash != contentHash) throw new InvalidDataException($"{position}已录入，内容被修改。请还原原记录，新增一条登记变更。");
                    run.SkippedCount++;
                    continue;
                }
                if (!row.Submit) { waiting = true; run.SkippedCount++; continue; }
                if (waiting) throw new InvalidDataException($"{position}之前还有待填写记录，请先完成前序记录，避免继承错误。");
                if (!DateOnly.TryParseExact(row.RecordDate, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out _)) throw new InvalidDataException($"{position}记录日期应为 YYYY-MM-DD 文本，例如 2026-09-18。");
                if (string.IsNullOrWhiteSpace(row.Reason) || row.Reason.Length > 500) throw new InvalidDataException($"{position}必须填写不超过 500 字的变更说明。");
                if (row.Values.Values.Any(x => x.Length > 160)) throw new InvalidDataException($"{position}版本号不能超过 160 字。");
                var items = preceding.Select(x => x with { Changed = false, PreviousVersionId = x.VersionId, PreviousVersionNumber = x.VersionNumber }).ToList();
                for (var i = 0; i < items.Count; i++)
                {
                    var item = items[i];
                    if (!row.Values.TryGetValue(item.ComponentId, out var number) || string.IsNullOrWhiteSpace(number)) continue;
                    var normalized = number.Trim().ToUpperInvariant();
                    var version = availableVersions.SingleOrDefault(x => x.ComponentId == item.ComponentId && x.NormalizedVersionNumber == normalized);
                    if (version is null)
                    {
                        var command = await ComponentVersionCommands.CreateAsync(db, item.ComponentId, number, row.Reason, writeContext, ct, VersionMaturity.Testing);
                        version = command.Version ?? throw new InvalidDataException($"{position}版本与并发登记冲突，请重新扫描。");
                        availableVersions.Add(version);
                    }
                    items[i] = item with { VersionId = version.Id, VersionNumber = version.VersionNumber, Changed = item.VersionId != version.Id };
                }
                var unavailable = items.FirstOrDefault(item => item.VersionId != null && !availableVersions.Any(version => version.Id == item.VersionId));
                if (unavailable is not null) throw new InvalidDataException($"{position}沿用的「{unavailable.ComponentName} / {unavailable.VersionNumber}」已被管理员删除。请在本条明确填写该组件的正确版本，不能继续继承误登记版本。");
                var combination = new MatrixImportCombination { Id = Guid.NewGuid(), ProjectId = projectId, TemplateId = templateId, RunId = run.Id, RowKey = row.RowKey, SourceRow = row.RowNumber, SequenceNo = ++sequence, ContentHash = contentHash, RecordDate = row.RecordDate, Reason = row.Reason, CreatedAt = DateTimeOffset.UtcNow, Items = Document(items) };
                db.MatrixImportCombinations.Add(combination);
                foreach (var item in items) db.MatrixImportReferences.Add(new() { Id = Guid.NewGuid(), TemplateId = templateId, CombinationId = combination.Id, ComponentId = item.ComponentId, VersionId = item.VersionId });
                Audit(db, writeContext, "MatrixCombinationImported", combination.Id, new { projectId, templateId, sourceId, row.RowNumber, row.Reason, changed = items.Count(x => x.Changed), grantorUserId = userId });
                preceding = items;
                run.ImportedCount++;
                foreach (var item in items.Where(item => item.Changed))
                    messages.Add(new(row.RowNumber, "info", $"{item.ComponentName} 从 {item.PreviousVersionNumber ?? "未指定"} 变为 {item.VersionNumber ?? "未指定"}",
                        combination.Id, item.ComponentId, item.ComponentName, item.PreviousVersionNumber, item.VersionNumber, position));
                if (!items.Any(item => item.Changed)) messages.Add(new(row.RowNumber, "info", "沿用前一套配置，无组件版本变更。", combination.Id, SourceLabel: position));
                await db.SaveChangesAsync(ct);
            }
        }
        catch (Exception error) when (error is InvalidDataException or ArgumentException or System.Xml.XmlException or IOException or UnauthorizedAccessException or DbUpdateException)
        {
            await transaction.RollbackToSavepointAsync("matrix_content", ct);
            db.ChangeTracker.Clear();
            run.ImportedCount = 0; run.SkippedCount = 0; run.Status = "Failed";
            retryFile = error is IOException or UnauthorizedAccessException;
            messages.Clear();
            messages.Add(new(null, "error", error is DbUpdateException ? "记录与现有数据冲突，本轮未录入任何内容，请刷新后重试。" : error is IOException or UnauthorizedAccessException ? "无法稳定读取文件，请检查部署电脑上的路径、共享权限以及文件是否正在保存。" : error.Message));
            if (sourceId is Guid sourceKey) source = await db.MatrixImportSources.SingleAsync(x => x.Id == sourceKey, ct);
        }
        run.Messages = Document(messages);
        db.MatrixImportRuns.Add(run);
        if (source is not null)
        {
            source.LastScanAt = run.CreatedAt; source.LastStatus = run.Status;
            source.NextScanAt = retryFile ? DateTimeOffset.UtcNow.AddMinutes(5) : NextScan(source.LocalTime, source.TimeZoneId, DateTimeOffset.UtcNow);
        }
        Audit(db, new(actor, correlationId), "MatrixWorkbookScanned", run.Id, new { projectId, templateId, sourceId, run.ImportedCount, run.SkippedCount, run.Status, reason, grantorUserId = userId });
        db.IdempotencyRecords.Add(new() { Id = Guid.NewGuid(), Scope = scope, IdempotencyKey = key, RequestHash = hash, CreatedAt = DateTimeOffset.UtcNow, ExpiresAt = DateTimeOffset.UtcNow.AddDays(7), Status = IdempotencyRecordStatus.Completed, Result = Document(run) });
        await db.SaveChangesAsync(ct);
        await transaction.CommitAsync(ct);
        return run;
    }

    public static DateTimeOffset NextScan(string localTime, string zoneId, DateTimeOffset now)
    {
        if (!TimeOnly.TryParseExact(localTime, "HH:mm", CultureInfo.InvariantCulture, DateTimeStyles.None, out var time)) throw new ArgumentException("扫描时间应为 HH:mm。");
        var zone = TimeZoneInfo.FindSystemTimeZoneById(zoneId);
        var local = TimeZoneInfo.ConvertTime(now, zone).Date.Add(time.ToTimeSpan());
        if (local <= TimeZoneInfo.ConvertTime(now, zone).DateTime) local = local.AddDays(1);
        while (zone.IsInvalidTime(local)) local = local.AddMinutes(1);
        return new DateTimeOffset(TimeZoneInfo.ConvertTimeToUtc(DateTime.SpecifyKind(local, DateTimeKind.Unspecified), zone));
    }

    public static async Task<byte[]> ReadStableFileAsync(string path, CancellationToken ct)
    {
        if (!Path.IsPathFullyQualified(path) || !path.EndsWith(".xlsx", StringComparison.OrdinalIgnoreCase) || Path.GetFileName(path).StartsWith("~$", StringComparison.Ordinal)) throw new ArgumentException("请选择部署电脑可访问的完整 .xlsx 路径，不支持 Excel 临时文件。");
        for (var attempt = 0; attempt < 3; attempt++)
        {
            var before = new FileInfo(path);
            var size = before.Length; var modified = before.LastWriteTimeUtc;
            if (size > MatrixWorkbook.MaximumBytes) throw new InvalidDataException("Excel 不能超过 10 MiB。");
            await Task.Delay(300, ct);
            await using var input = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read);
            using var output = new MemoryStream();
            await input.CopyToAsync(output, ct);
            var after = new FileInfo(path);
            if (size == output.Length && after.Length == size && after.LastWriteTimeUtc == modified) return output.ToArray();
        }
        throw new IOException("文件仍在保存，请稍后重试。");
    }

    public static void Audit(ConfigHubDbContext db, VersionWriteContext context, string action, Guid id, object data) => db.AuditEvents.Add(new()
    {
        Id = Guid.NewGuid(), Actor = context.Actor[..Math.Min(context.Actor.Length, 160)], Action = action, EntityType = "MatrixImport", EntityId = id,
        CorrelationId = context.CorrelationId[..Math.Min(context.CorrelationId.Length, 128)], Data = Document(data), OccurredAt = DateTimeOffset.UtcNow
    });
}
