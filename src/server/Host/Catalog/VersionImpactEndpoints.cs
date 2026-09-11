using System.Text;
using ConfigHub.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace ConfigHub.Host.Catalog;

public static partial class CatalogEndpoints
{
    private sealed record ChamberVersionUsage(Guid MachineId, string MachineName, string SerialNumber, bool MachineDeleted,
        int ChamberNumber, bool ChamberInstalled, Guid ComponentId, string ComponentName);

    private sealed record ChamberVersionFact(Guid Id, ChamberVersionUsage Usage, Guid HistoryId, long Sequence,
        DateTimeOffset RecordedAt, string Actor, string Reason, bool IsCurrent);

    private sealed record VersionChamberImpact(ChamberVersionUsage[] CurrentUsages, ChamberVersionUsage[] HistoricalUsages,
        ChamberVersionFact[] RecentFacts, int HistoricalFactCount);

    private static async Task<VersionChamberImpact> GetVersionChamberImpactAsync(ConfigHubDbContext db, Guid versionId, CancellationToken ct)
    {
        // Evaluate the latest fact before filtering its version: a later null means inheritance, not this old override.
        var references = await (
            from fact in db.MachineChamberVersions.AsNoTracking()
            where fact.VersionId == versionId
            join chamber in db.MachineChambers.AsNoTracking() on fact.ChamberId equals chamber.Id
            join machine in db.Machines.IgnoreQueryFilters().AsNoTracking() on chamber.MachineId equals machine.Id
            join component in db.ConfigurationComponents.AsNoTracking() on fact.ComponentId equals component.Id
            join history in db.MachineEquipmentHistory.AsNoTracking() on fact.HistoryId equals history.Id
            select new ChamberVersionFact(fact.Id,
                new ChamberVersionUsage(machine.Id, machine.Name, machine.SerialNumber, machine.DeletedAt != null,
                    chamber.Number, chamber.Installed, component.Id, component.Name),
                history.Id, fact.Sequence, history.RecordedAt, history.Actor, history.Reason,
                machine.DeletedAt == null && chamber.Installed && !db.MachineChamberVersions.Any(later =>
                    later.ChamberId == fact.ChamberId && later.ComponentId == fact.ComponentId && later.Sequence > fact.Sequence)))
            .ToListAsync(ct);

        return new(
            references.Where(fact => fact.IsCurrent).Select(fact => fact.Usage).Distinct().OrderBy(item => item.MachineName).ThenBy(item => item.ChamberNumber).ToArray(),
            references.Select(fact => fact.Usage).Distinct().OrderBy(item => item.MachineName).ThenBy(item => item.ChamberNumber).ToArray(),
            references.OrderByDescending(fact => fact.RecordedAt).ThenByDescending(fact => fact.Sequence).ThenBy(fact => fact.Id).Take(20).ToArray(),
            references.Count);
    }

    private static void AppendChamberImpactCsv(StringBuilder csv, VersionChamberImpact impact)
    {
        csv.Append("\r\nPM 引用范围,机台名称,机台序列号,腔室,组件名称,机台状态,腔室状态\r\n");
        foreach (var (scope, usages) in new[] { ("当前特例", impact.CurrentUsages), ("历史引用", impact.HistoricalUsages) })
        {
            foreach (var usage in usages)
            {
                string[] cells = [scope, usage.MachineName, usage.SerialNumber, $"PM{usage.ChamberNumber}", usage.ComponentName,
                    usage.MachineDeleted ? "已删除" : "在用", usage.ChamberInstalled ? "已安装" : "已移除"];
                csv.AppendJoin(',', cells.Select(ImpactCsvCell)).Append("\r\n");
            }
        }
    }

    private static string ImpactCsvCell(string value)
    {
        var trimmed = value.TrimStart();
        if (trimmed.Length > 0 && "=+-@".Contains(trimmed[0]) || value.StartsWith('\t') || value.StartsWith('\r')) value = "'" + value;
        return "\"" + value.Replace("\"", "\"\"") + "\"";
    }
}
