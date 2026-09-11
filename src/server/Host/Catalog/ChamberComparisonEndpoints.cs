using ConfigHub.Infrastructure.Persistence;
using ConfigHub.Infrastructure.Persistence.Entities;
using Microsoft.EntityFrameworkCore;

namespace ConfigHub.Host.Catalog;

public static partial class CatalogEndpoints
{
    private sealed record ChamberConfigurationValue(Guid? VersionId, string State, string Source);
    private sealed record EffectiveChamberConfiguration(Guid MachineId, int Number, Dictionary<Guid, ChamberConfigurationValue> Items);
    private sealed record ChamberComparisonVersion(string VersionNumber, VersionSafety Safety);
    private sealed record ChamberComparisonItem(
        Guid ComponentId, string ComponentName, string Status,
        Guid? LeftVersionId, string? LeftVersionNumber, Guid? RightVersionId, string? RightVersionNumber,
        string LeftState, string RightState, string LeftSource, string RightSource);
    private sealed record ChamberComparison(
        int Number, bool LeftInstalled, bool? RightInstalled, string MatchStatus, string RiskSeverity,
        ChamberComparisonItem[] Items);

    private static async Task<EffectiveChamberConfiguration[]> LoadEffectiveChambersAsync(
        ConfigHubDbContext db, Guid[] machineIds, IEnumerable<MachineCurrentConfiguration> states, CancellationToken ct)
    {
        var chambers = await db.MachineChambers.AsNoTracking()
            .Where(chamber => machineIds.Contains(chamber.MachineId) && chamber.Installed)
            .OrderBy(chamber => chamber.Number).ToArrayAsync(ct);
        if (chambers.Length == 0) return [];
        var chamberIds = chambers.Select(chamber => chamber.Id).ToArray();
        // Keep the latest null fact in the selection: it means inheritance, not the previous override.
        var latest = await db.MachineChamberVersions.AsNoTracking()
            .Where(fact => chamberIds.Contains(fact.ChamberId)
                && !db.MachineChamberVersions.Any(next => next.ChamberId == fact.ChamberId
                    && next.ComponentId == fact.ComponentId && next.Sequence > fact.Sequence))
            .ToArrayAsync(ct);
        var wholeMachine = states.ToLookup(state => state.MachineId);
        return chambers.Select(chamber =>
        {
            var effective = wholeMachine[chamber.MachineId].ToDictionary(state => state.ConfigurationComponentId,
                state => new ChamberConfigurationValue(
                    state.State == CurrentConfigurationState.Present ? state.ComponentVersionId : null,
                    state.State.ToString(), "Machine"));
            foreach (var fact in latest.Where(fact => fact.ChamberId == chamber.Id && fact.VersionId is not null))
                effective[fact.ComponentId] = new(fact.VersionId, "Present", "Override");
            return new EffectiveChamberConfiguration(chamber.MachineId, chamber.Number, effective);
        }).ToArray();
    }

    private static async Task<ChamberComparison[]> BuildMachineBaselineChamberComparisonsAsync(
        ConfigHubDbContext db, Guid machineId, Dictionary<Guid, BaselineItem> baseline,
        IEnumerable<MachineCurrentConfiguration> states, CancellationToken ct)
    {
        var chambers = await LoadEffectiveChambersAsync(db, [machineId], states, ct);
        if (chambers.Length == 0) return [];
        var expected = baseline.ToDictionary(item => item.Key,
            item => new ChamberConfigurationValue(item.Value.ComponentVersionId, "Present", "Baseline"));
        var values = chambers.SelectMany(chamber => chamber.Items.Values).Concat(expected.Values).ToArray();
        var versions = await LoadChamberComparisonVersionsAsync(db, values, ct);
        var componentIds = chambers.SelectMany(chamber => chamber.Items.Keys).Union(expected.Keys).ToArray();
        var names = await db.ConfigurationComponents.AsNoTracking().Where(component => componentIds.Contains(component.Id))
            .ToDictionaryAsync(component => component.Id, component => component.Name, ct);
        foreach (var item in baseline.Values) names[item.ConfigurationComponentId] = item.ComponentNameSnapshot;
        return chambers.Select(chamber => BuildChamberComparison(chamber.Number, chamber.Items, expected,
            true, null, names, versions, baseline)).ToArray();
    }

    private static async Task<ChamberComparison[]> BuildMachineChamberComparisonsAsync(
        ConfigHubDbContext db, Guid leftMachineId, Guid rightMachineId,
        IEnumerable<MachineCurrentConfiguration> states, CancellationToken ct)
    {
        var chambers = await LoadEffectiveChambersAsync(db, [leftMachineId, rightMachineId], states, ct);
        if (chambers.Length == 0) return [];
        var versions = await LoadChamberComparisonVersionsAsync(db, chambers.SelectMany(chamber => chamber.Items.Values), ct);
        var componentIds = chambers.SelectMany(chamber => chamber.Items.Keys).Distinct().ToArray();
        var names = await db.ConfigurationComponents.AsNoTracking().Where(component => componentIds.Contains(component.Id))
            .ToDictionaryAsync(component => component.Id, component => component.Name, ct);
        var left = chambers.Where(chamber => chamber.MachineId == leftMachineId).ToDictionary(chamber => chamber.Number);
        var right = chambers.Where(chamber => chamber.MachineId == rightMachineId).ToDictionary(chamber => chamber.Number);
        return left.Keys.Union(right.Keys).OrderBy(number => number).Select(number =>
        {
            var before = left.GetValueOrDefault(number);
            var after = right.GetValueOrDefault(number);
            return BuildChamberComparison(number, before?.Items ?? [], after?.Items ?? [],
                before is not null, after is not null, names, versions);
        }).ToArray();
    }

    private static async Task<Dictionary<Guid, ChamberComparisonVersion>> LoadChamberComparisonVersionsAsync(
        ConfigHubDbContext db, IEnumerable<ChamberConfigurationValue> values, CancellationToken ct)
    {
        var versionIds = values.Where(value => value.VersionId is not null).Select(value => value.VersionId!.Value).Distinct().ToArray();
        return await db.ComponentVersions.AsNoTracking().Where(version => versionIds.Contains(version.Id))
            .ToDictionaryAsync(version => version.Id, version => new ChamberComparisonVersion(version.VersionNumber, version.Safety), ct);
    }

    private static ChamberComparison BuildChamberComparison(
        int number, Dictionary<Guid, ChamberConfigurationValue> left, Dictionary<Guid, ChamberConfigurationValue> right,
        bool leftInstalled, bool? rightInstalled, Dictionary<Guid, string> names,
        Dictionary<Guid, ChamberComparisonVersion> versions, Dictionary<Guid, BaselineItem>? baseline = null)
    {
        var leftMissing = new ChamberConfigurationValue(null, leftInstalled ? "Unknown" : "NotInstalled", leftInstalled ? "Machine" : "NotInstalled");
        var rightMissing = new ChamberConfigurationValue(null, rightInstalled is null ? "Absent" : rightInstalled.Value ? "Unknown" : "NotInstalled",
            rightInstalled is null ? "Baseline" : rightInstalled.Value ? "Machine" : "NotInstalled");
        var items = left.Keys.Union(right.Keys).OrderBy(id => names[id], StringComparer.Ordinal).ThenBy(id => id).Select(id =>
        {
            var before = left.GetValueOrDefault(id) ?? leftMissing;
            var after = right.GetValueOrDefault(id) ?? rightMissing;
            var status = before.State == "NotInstalled" || after.State == "NotInstalled" ? "Mismatch"
                : before.State == "Unknown" || after.State == "Unknown" ? "Unknown"
                : before.State == after.State && before.VersionId == after.VersionId ? "Matched"
                : before.State == "Absent" ? "RightOnly" : after.State == "Absent" ? "LeftOnly" : "Mismatch";
            return new ChamberComparisonItem(id, names[id], status,
                before.VersionId, before.VersionId is null ? null : versions[before.VersionId.Value].VersionNumber,
                after.VersionId, after.VersionId is null ? null : baseline?.GetValueOrDefault(id)?.VersionNumberSnapshot ?? versions[after.VersionId.Value].VersionNumber,
                before.State, after.State, before.Source, after.Source);
        }).ToArray();
        var installationMismatch = !leftInstalled || rightInstalled == false;
        var match = installationMismatch || items.Any(item => item.Status is not ("Matched" or "Unknown")) ? "Mismatch"
            : items.Length == 0 || items.Any(item => item.Status == "Unknown") ? "Unknown" : "Matched";
        var critical = items.Any(item => item.LeftState == "Present" && item.LeftVersionId is { } leftVersion && versions[leftVersion].Safety == VersionSafety.Blocked
            || item.RightState == "Present" && item.RightVersionId is { } rightVersion && versions[rightVersion].Safety == VersionSafety.Blocked);
        return new(number, leftInstalled, rightInstalled, match, critical ? "Critical" : "None", items);
    }
}
