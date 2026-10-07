using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using ConfigHub.Infrastructure.Persistence;
using ConfigHub.Infrastructure.Persistence.Entities;
using Microsoft.EntityFrameworkCore;

namespace ConfigHub.Infrastructure.ExcelImport;

public sealed record HistoricalPreviewItem(Guid ComponentId, Guid? ParentComponentId, string Name, int SortOrder, bool IsCategory,
    string? VersionNumber, Guid? VersionId, bool NotConfigured, string CurrentMaturity, string CurrentSafety, bool WillCreate);
public sealed record HistoricalPreviewRecord(string RowKey, string Position, string Name, DateTimeOffset ReleasedAt, string Reason,
    IReadOnlyList<HistoricalPreviewItem> Items, bool Imported, Guid? BaselineId);

public static class HistoricalBaselineCommands
{
    public const string Absent = "当时未配置";
    public static string Hash(object value) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(value, MatrixImportService.Json))));
    public static string RowHash(MatrixInputRow row) => row.RecordType == "Testing"
        ? Hash(new { row.RecordDate, row.Reason, values = row.Values.OrderBy(x => x.Key) })
        : Hash(new { row.RecordType, row.RecordDate, row.Reason, row.BaselineName, row.ReleasedAt, values = row.Values.OrderBy(x => x.Key) });

    public static async Task<List<HistoricalPreviewRecord>> ValidateAsync(ConfigHubDbContext db, Guid projectId, Guid templateId,
        IReadOnlyList<MatrixComponent> template, IReadOnlyList<MatrixInputRow> rows, CancellationToken ct)
    {
        var components = await db.ConfigurationComponents.Where(x => x.ProjectId == projectId).OrderBy(x => x.Id).ToListAsync(ct);
        var ids = components.Select(x => x.Id).ToArray();
        var versions = await db.ComponentVersions.Where(x => ids.Contains(x.ComponentId)).ToListAsync(ct);
        var existing = await db.MatrixHistoricalRecords.Where(x => x.TemplateId == templateId).ToDictionaryAsync(x => x.RowKey, ct);
        var testingKeys = (await db.MatrixImportCombinations.Where(x => x.TemplateId == templateId).Select(x => x.RowKey).ToListAsync(ct)).ToHashSet();
        var names = (await db.ConfigurationBaselines.Where(x => x.ProjectId == projectId).Select(x => x.NormalizedBaselineCode).ToListAsync(ct)).ToHashSet();
        var result = new List<HistoricalPreviewRecord>();
        foreach (var row in rows.Where(x => x.RecordType == "HistoricalBaseline"))
        {
            var position = row.SourceLabel ?? $"第 {row.RowNumber} 行";
            if (testingKeys.Contains(row.RowKey)) throw new InvalidDataException($"{position}已作为测试配置录入，不能更改记录类型，请新增一列历史基线。");
            if (existing.TryGetValue(row.RowKey, out var imported))
            {
                if (imported.ContentHash != RowHash(row)) throw new InvalidDataException($"{position}历史基线已导入，不能改写原记录。");
                result.Add(new(row.RowKey, position, row.BaselineName!, ParseTime(row.ReleasedAt), row.Reason, [], true, imported.BaselineId));
                continue;
            }
            if (components.Count != template.Count || components.Any(c => !template.Any(t => t.ComponentId == c.Id && t.ParentComponentId == c.ParentComponentId
                && t.ComponentName == c.Name && t.SortOrder == c.SortOrder && t.IsCategory == (!versions.Any(v => v.ComponentId == c.Id) && components.Any(child => child.ParentComponentId == c.Id)))))
                throw new InvalidDataException($"{position}组件树已变化，请重新生成模板，历史基线必须校验完整组件结构。");
            var name = row.BaselineName?.Trim() ?? "";
            if (name.Length is 0 or > 100 || name.Any(char.IsControl)) throw new InvalidDataException($"{position}基线名称必填且最多 100 字。");
            if (!names.Add(name.ToUpperInvariant())) throw new InvalidDataException($"{position}基线名称「{name}」已存在或在文件内重复。");
            if (string.IsNullOrWhiteSpace(row.Reason) || row.Reason.Length > 500) throw new InvalidDataException($"{position}必须填写补录说明，最多 500 字。");
            var publishedAt = ParseTime(row.ReleasedAt);
            var items = new List<HistoricalPreviewItem>();
            foreach (var component in template)
            {
                var number = row.Values.GetValueOrDefault(component.ComponentId)?.Trim() ?? "";
                if (!component.IsCategory && number.Length is 0 or > 160) throw new InvalidDataException($"{position}「{component.ComponentName}」必须填写版本或“{Absent}”，版本最多 160 字。");
                var absent = !component.IsCategory && number == Absent;
                var normalizedNumber = number.ToUpperInvariant();
                var version = versions.SingleOrDefault(v => v.ComponentId == component.ComponentId && v.NormalizedVersionNumber == normalizedNumber);
                items.Add(new(component.ComponentId, component.ParentComponentId, component.ComponentName, component.SortOrder, component.IsCategory,
                    component.IsCategory || absent ? null : number, version?.Id, absent, version?.Maturity.ToString() ?? "", version?.Safety.ToString() ?? "", !component.IsCategory && !absent && version is null));
            }
            if (!items.Any(x => !x.IsCategory && !x.NotConfigured)) throw new InvalidDataException($"{position}历史基线至少需要一个实际版本。");
            result.Add(new(row.RowKey, position, name, publishedAt, row.Reason, items, false, null));
        }
        return result;
    }

    public static DateTimeOffset ParseTime(string? text)
    {
        if (!DateTime.TryParseExact(text, "yyyy-MM-dd HH:mm", CultureInfo.InvariantCulture, DateTimeStyles.None, out var local)) throw new InvalidDataException("历史发布时间须为 YYYY-MM-DD HH:mm（北京时间）。");
        var time = new DateTimeOffset(DateTime.SpecifyKind(local, DateTimeKind.Unspecified), TimeSpan.FromHours(8)).ToUniversalTime();
        if (time < new DateTimeOffset(2000, 1, 1, 0, 0, 0, TimeSpan.Zero) || time > DateTimeOffset.UtcNow) throw new InvalidDataException("历史发布时间须在 2000 年至现在之间。");
        return time;
    }

    public static async Task<Guid> ExecuteAsync(ConfigHubDbContext db, Guid userId, Guid projectId, Guid templateId,
        MatrixInputRow row, HistoricalPreviewRecord record, VersionWriteContext actor, CancellationToken ct)
    {
        if (db.Database.CurrentTransaction is null) throw new InvalidOperationException("历史基线命令必须在事务内执行。");
        if (!await MatrixImportService.CanImportAsync(db, userId, projectId, ct, true)) throw new UnauthorizedAccessException();
        if (record.Imported) return record.BaselineId!.Value;
        var now = DateTimeOffset.UtcNow;
        var series = await db.BaselineSeries.SingleOrDefaultAsync(x => x.ProjectId == projectId && x.NormalizedSeriesCode == "HISTORY", ct);
        if (series is null) { series = new() { Id = Guid.NewGuid(), ProjectId = projectId, SeriesCode = "HISTORY", NormalizedSeriesCode = "HISTORY", CreatedAt = now }; db.BaselineSeries.Add(series); }
        var revision = (await db.ConfigurationBaselines.Where(x => x.BaselineSeriesId == series.Id).Select(x => (int?)x.RevisionNo).MaxAsync(ct) ?? 0) + 1;
        var baseline = new ConfigurationBaseline { Id = Guid.NewGuid(), ProjectId = projectId, BaselineSeriesId = series.Id, BaselineCode = record.Name, NormalizedBaselineCode = record.Name.ToUpperInvariant(), RevisionNo = revision,
            CreatedBy = actor.Actor, CreatedAt = now, IsHistorical = true, Description = record.Reason };
        db.ConfigurationBaselines.Add(baseline);
        var components = await db.ConfigurationComponents.Where(x => x.ProjectId == projectId).ToDictionaryAsync(x => x.Id, ct);
        var itemIds = record.Items.ToDictionary(x => x.ComponentId, _ => Guid.NewGuid());
        foreach (var item in record.Items)
        {
            var component = components[item.ComponentId];
            var version = item.IsCategory || item.NotConfigured ? null : await ComponentVersionCommands.RegisterHistoricalAsync(db, item.ComponentId, item.VersionNumber!, record.ReleasedAt, record.Reason, actor, ct);
            db.BaselineItems.Add(new() { Id = itemIds[item.ComponentId], ConfigurationBaselineId = baseline.Id, ConfigurationComponentId = item.ComponentId,
                ComponentVersionId = version?.Id, VersionNumberSnapshot = version?.VersionNumber, NotConfigured = item.NotConfigured, HistoricalVersionState = version is null ? null : "HistoricalReleased",
                ParentBaselineItemId = item.ParentComponentId is Guid parent ? itemIds[parent] : null, ComponentCodeSnapshot = component.ComponentCode,
                ComponentNameSnapshot = component.Name, LineageKeySnapshot = component.LineageKey, SortOrder = component.SortOrder });
        }
        await db.SaveChangesAsync(ct);
        baseline.State = BaselineState.Released; baseline.ReleasedAt = record.ReleasedAt; baseline.ReleasedBy = actor.Actor; baseline.ReleaseReason = record.Reason;
        db.BaselineLifecycleTransitions.Add(new() { Id = Guid.NewGuid(), ConfigurationBaselineId = baseline.Id, FromState = "HistoricalRecord", ToState = "Released", Actor = actor.Actor, Reason = record.Reason, OccurredAt = now });
        db.MatrixHistoricalRecords.Add(new() { Id = Guid.NewGuid(), TemplateId = templateId, RowKey = row.RowKey, ContentHash = RowHash(row), BaselineId = baseline.Id, RecordedAt = now });
        MatrixImportService.Audit(db, actor, "HistoricalBaselineImported", baseline.Id, new { projectId, templateId, row.RowKey, publishedAt = record.ReleasedAt, record.Reason, record.Items });
        await db.SaveChangesAsync(ct);
        return baseline.Id;
    }
}
